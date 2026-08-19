import type { SupabaseClient } from '@supabase/supabase-js';
import { parseNairaAmount } from '@/lib/ai/parseNairaAmount';
import { transcribeAudio, type SttProvider } from '@/lib/voice/sttService';
import type { AIAction, AIResponse } from '@/lib/booking/action-validator';

export type CaptureRecordType =
  | 'expense'
  | 'purchase'
  | 'stock_receipt'
  | 'supplier_payment'
  | 'retail_sale'
  | 'service'
  | 'stock_count';

export interface CaptureDependencyReport {
  transcription: {
    module: string;
    providers: string[];
    defaultProvider: string;
  };
  vision: {
    modules: string[];
    notes: string;
  };
}

export interface CaptureExtractionRequest {
  kind: 'receipt' | 'invoice' | 'voice' | 'photo' | 'pdf' | 'stock_sheet' | 'screenshot' | 'service_note';
  mime: string;
  buffer: Buffer;
  tenantId: string;
  jobId: string;
  textContent?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CaptureProviderInput {
  kind: CaptureExtractionRequest['kind'];
  mime: string;
  text: string;
  metadata: Record<string, unknown>;
}

export interface CaptureProviderOutput {
  recordType: CaptureRecordType;
  fields: Record<string, unknown>;
  fieldConfidence: Record<string, number>;
  model: string;
  promptVersion: string;
  raw?: unknown;
}

export interface CaptureExtractionProvider {
  extract(input: CaptureProviderInput): Promise<CaptureProviderOutput>;
}

export interface PersistedExtractionResult {
  extractedRecordId: string;
  recordType: CaptureRecordType;
  fields: Record<string, unknown>;
  lowConfidenceFields: string[];
  proposedAction: AIResponse | null;
  transcriptionText?: string | null;
}

function normalizeConfidence(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function collectLowConfidenceFields(confidence: Record<string, number>, threshold = 0.8): string[] {
  return Object.entries(confidence)
    .filter(([, value]) => normalizeConfidence(value) < threshold)
    .map(([field]) => field);
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return value.slice(0, 10);
}

function normalizeAmountFields(fields: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...fields };
  const mappings: Array<[string, string]> = [
    ['amount', 'amount_cents'],
    ['total', 'total_cents'],
    ['payment_amount', 'payment_amount_cents'],
    ['unit_price', 'unit_price_cents'],
  ];

  for (const [sourceKey, targetKey] of mappings) {
    if (normalized[targetKey] !== undefined) continue;
    const raw = normalized[sourceKey];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      normalized[targetKey] = Math.round(raw * 100);
      continue;
    }
    if (typeof raw === 'string') {
      const parsed = parseNairaAmount(raw);
      if (parsed !== null) normalized[targetKey] = parsed;
    }
  }

  const dateMappings = ['date', 'expense_date', 'purchase_date', 'payment_date'];
  for (const key of dateMappings) {
    const normalizedDate = normalizeDate(normalized[key]);
    if (normalizedDate) normalized[key] = normalizedDate;
  }

  return normalized;
}

export function buildCaptureReviewAction(recordType: CaptureRecordType, fields: Record<string, unknown>): AIResponse | null {
  switch (recordType) {
    case 'expense':
      return {
        action: 'record_expense' satisfies AIAction,
        params: fields,
        reply: 'Review extracted expense before confirmation.',
        confidence: 'medium',
      };
    case 'purchase':
      return {
        action: 'record_purchase' satisfies AIAction,
        params: fields,
        reply: 'Review extracted purchase before confirmation.',
        confidence: 'medium',
      };
    case 'supplier_payment':
      return {
        action: 'record_supplier_payment' satisfies AIAction,
        params: fields,
        reply: 'Review extracted supplier payment before confirmation.',
        confidence: 'medium',
      };
    case 'stock_receipt':
      return {
        action: 'record_stock_receipt' satisfies AIAction,
        params: fields,
        reply: 'Review extracted stock receipt before confirmation.',
        confidence: 'medium',
      };
    case 'stock_count':
      return {
        action: 'create_stock_count_session' satisfies AIAction,
        params: {
          items: Array.isArray(fields.items) ? fields.items : [],
          source: 'multimodal_capture',
          capture_record_type: recordType,
        },
        reply: 'Review extracted stock count before opening a stock-count session.',
        confidence: 'medium',
      };
    case 'service':
      return {
        action: 'complete_service_capture' satisfies AIAction,
        params: {
          ...fields,
          source: 'multimodal_capture',
          capture_record_type: recordType,
        },
        reply: 'Review extracted service note before completing the service record.',
        confidence: 'medium',
      };
    case 'retail_sale':
      return {
        action: 'owner_query' satisfies AIAction,
        params: {
          capture_record_type: recordType,
          fields,
          source: 'multimodal_capture',
        },
        reply: 'Review extracted business record before confirmation.',
        confidence: 'medium',
      };
    default:
      return null;
  }
}

export function verifyCaptureDependencies(): CaptureDependencyReport {
  return {
    transcription: {
      module: 'src/lib/voice/sttService.ts',
      providers: ['openai: whisper-1', 'local: whisper.cpp sidecar'],
      defaultProvider: 'openai',
    },
    vision: {
      modules: ['src/lib/openrouter.ts', 'src/lib/google-ai.ts'],
      notes: 'No dedicated OCR package is present; multimodal extraction must route through an LLM/vision provider adapter.',
    },
  };
}

export async function extractAndPersistRecord(
  admin: SupabaseClient,
  provider: CaptureExtractionProvider,
  request: CaptureExtractionRequest,
  options: { sttProvider?: SttProvider } = {},
): Promise<PersistedExtractionResult> {
  let text = request.textContent?.trim() ?? '';
  let transcriptionText: string | null = null;

  if (request.kind === 'voice') {
    const transcript = await transcribeAudio(request.buffer, options.sttProvider ?? 'openai');
    transcriptionText = transcript.text;
    text = transcript.text.trim();
  }

  const providerOutput = await provider.extract({
    kind: request.kind,
    mime: request.mime,
    text,
    metadata: request.metadata ?? {},
  });

  const normalizedFields = normalizeAmountFields(providerOutput.fields);
  const normalizedConfidence = Object.fromEntries(
    Object.entries(providerOutput.fieldConfidence).map(([key, value]) => [key, normalizeConfidence(value)]),
  );
  const lowConfidenceFields = collectLowConfidenceFields(normalizedConfidence);
  const proposedAction = buildCaptureReviewAction(providerOutput.recordType, normalizedFields);

  const { data: extractedRecord, error: extractedError } = await admin
    .from('extracted_records')
    .insert({
      tenant_id: request.tenantId,
      job_id: request.jobId,
      record_type: providerOutput.recordType,
      fields: normalizedFields,
      field_confidence: normalizedConfidence,
      low_confidence_fields: lowConfidenceFields,
      proposed_action: proposedAction,
    })
    .select('id')
    .single<{ id: string }>();

  if (extractedError || !extractedRecord?.id) {
    throw extractedError ?? new Error('Failed to persist extracted record');
  }

  const { error: updateError } = await admin
    .from('extraction_jobs')
    .update({
      status: 'review_required',
      model: providerOutput.model,
      prompt_version: providerOutput.promptVersion,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', request.tenantId)
    .eq('id', request.jobId);

  if (updateError) throw updateError;

  return {
    extractedRecordId: extractedRecord.id,
    recordType: providerOutput.recordType,
    fields: normalizedFields,
    lowConfidenceFields,
    proposedAction,
    transcriptionText,
  };
}
