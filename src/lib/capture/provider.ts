import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { defaultLogger } from '@/lib/logger';
import type { CaptureExtractionProvider, CaptureProviderInput, CaptureProviderOutput } from './extract';

type CaptureProviderName = 'openrouter' | 'google';

const OPENROUTER_BASE = process.env.OPENROUTER_BASE_URL || 'https://api.openrouter.ai/api/v1';
const GOOGLE_OPENAI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
const OPENROUTER_MODEL = process.env.BOOKA_CAPTURE_OPENROUTER_MODEL || process.env.OPENROUTER_DEFAULT_MODEL || 'openai/gpt-4.1-mini';
const GOOGLE_MODEL = process.env.BOOKA_CAPTURE_GOOGLE_MODEL || process.env.GOOGLE_AI_DEFAULT_MODEL || 'gemini-3.5-flash';

function parseJsonObject(content: string | null | undefined): Record<string, unknown> | null {
  if (!content) return null;
  const trimmed = content.trim();
  const direct = trimmed.startsWith('{') ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0] ?? null;
  if (!direct) return null;
  try {
    return JSON.parse(direct) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getMimeFamily(mime: string): 'image' | 'pdf' | 'audio' | 'text' {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  return 'text';
}

function buildPrompt(kind: CaptureProviderInput['kind']): string {
  const modalityHint = {
    receipt: 'receipt or expense proof',
    invoice: 'invoice or supplier bill',
    voice: 'spoken owner note',
    photo: 'business photo or photographed document',
    pdf: 'document or invoice PDF',
    stock_sheet: 'stock count sheet',
    screenshot: 'business screenshot',
    service_note: 'service completion note',
  }[kind];

  return [
    `You extract structured business data from a ${modalityHint}.`,
    'Return JSON only.',
    'Required top-level keys:',
    '- recordType: one of expense | purchase | stock_receipt | supplier_payment | retail_sale | service | stock_count',
    '- fields: object',
    '- fieldConfidence: object keyed exactly like fields with values from 0 to 1',
    'Field rules:',
    '- Monetary fields should be human-readable strings or integer minor units if you know them.',
    '- Dates should be ISO-like strings when possible.',
    '- For stock_count use fields.items with counted_units per product.',
    '- For service use fields that help complete a service and payment review.',
    '- For stock_receipt use fields.items with product_name, quantity, unit_cost, and total when visible.',
    'Do not wrap JSON in markdown.',
  ].join('\n');
}

function buildOpenRouterMessages(input: CaptureProviderInput): Array<{ role: string; content: unknown }> {
  const prompt = buildPrompt(input.kind);
  const mimeFamily = getMimeFamily(input.mime);

  if (mimeFamily === 'text' || mimeFamily === 'audio') {
    return [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'text', text: input.text || 'No transcription text was available.' },
        ],
      },
    ];
  }

  if (mimeFamily === 'pdf') {
    return [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'file',
            file: {
              filename: input.metadata.fileName ?? 'capture.pdf',
              file_data: `data:${input.mime};base64,${String(input.metadata.base64Data ?? '')}`,
            },
          },
        ],
      },
    ];
  }

  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        {
          type: 'image_url',
          image_url: {
            url: `data:${input.mime};base64,${String(input.metadata.base64Data ?? '')}`,
          },
        },
        ...(input.text ? [{ type: 'text', text: input.text }] : []),
      ],
    },
  ];
}

function buildGoogleMessages(input: CaptureProviderInput): Array<{ role: string; content: unknown }> {
  const prompt = buildPrompt(input.kind);
  const mimeFamily = getMimeFamily(input.mime);
  if (mimeFamily === 'pdf') {
    throw new Error('google_capture_provider_does_not_support_pdf_openai_compat');
  }
  if (mimeFamily === 'text' || mimeFamily === 'audio') {
    return [{ role: 'user', content: [{ type: 'text', text: `${prompt}\n\n${input.text || ''}` }] }];
  }
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        {
          type: 'image_url',
          image_url: {
            url: `data:${input.mime};base64,${String(input.metadata.base64Data ?? '')}`,
          },
        },
        ...(input.text ? [{ type: 'text', text: input.text }] : []),
      ],
    },
  ];
}

async function requestProvider(
  provider: CaptureProviderName,
  model: string,
  messages: Array<{ role: string; content: unknown }>,
): Promise<CaptureProviderOutput> {
  const isGoogle = provider === 'google';
  const apiKey = isGoogle ? process.env.GOOGLE_AI_API_KEY : process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(`${provider}_capture_provider_not_configured`);
  }

  const baseUrl = isGoogle ? GOOGLE_OPENAI_BASE : OPENROUTER_BASE;
  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    const body = await response.text();
    defaultLogger.error('[capture] provider extraction failed', {
      provider,
      model,
      status: response.status,
      body: body.slice(0, 300),
    });
    throw new Error(`${provider}_capture_provider_error_${response.status}`);
  }

  const json = await response.json() as Record<string, unknown>;
  const content = ((((json.choices as Array<Record<string, unknown>> | undefined)?.[0]
    ?.message as Record<string, unknown> | undefined)?.content) as string | undefined)
    ?? (((json.choices as Array<Record<string, unknown>> | undefined)?.[0]?.text) as string | undefined)
    ?? null;
  const parsed = parseJsonObject(content);
  if (!parsed) {
    throw new Error(`${provider}_capture_provider_invalid_json`);
  }

  const recordType = parsed.recordType;
  const fields = parsed.fields;
  const fieldConfidence = parsed.fieldConfidence;
  if (typeof recordType !== 'string' || !fields || typeof fields !== 'object' || !fieldConfidence || typeof fieldConfidence !== 'object') {
    throw new Error(`${provider}_capture_provider_missing_fields`);
  }

  return {
    recordType: recordType as CaptureProviderOutput['recordType'],
    fields: fields as Record<string, unknown>,
    fieldConfidence: fieldConfidence as Record<string, number>,
    model,
    promptVersion: 'capture-v2',
    raw: json,
  };
}

class LiveCaptureProvider implements CaptureExtractionProvider {
  async extract(input: CaptureProviderInput): Promise<CaptureProviderOutput> {
    const mimeFamily = getMimeFamily(input.mime);
    if (mimeFamily === 'pdf' || process.env.OPENROUTER_API_KEY) {
      return requestProvider('openrouter', OPENROUTER_MODEL, buildOpenRouterMessages(input));
    }
    if (process.env.GOOGLE_AI_API_KEY) {
      return requestProvider('google', GOOGLE_MODEL, buildGoogleMessages(input));
    }
    throw new Error('no_capture_provider_configured');
  }
}

export function createLiveCaptureProvider(): CaptureExtractionProvider {
  return new LiveCaptureProvider();
}

