import { defaultLogger } from '@/lib/logger';
import { trace } from '@opentelemetry/api';
import { llmCallDuration } from './metrics';
import { fetchWithTimeout } from './fetchWithTimeout';
import { getBestFreeModel, getFreeModels, rankFreeModels } from './openrouter-models';
import { isGoogleAIConfigured, getGoogleAIModel, isGeminiModel, callGoogleAI } from './google-ai';

type LLMReply = {
  reply_text: string;
  action: 'none' | 'create_reservation' | 'update_reservation' | 'cancel_reservation' | 'ask_followup';
  data?: Record<string, unknown>;
  // _llm_usage will be injected when available
  _llm_usage?: Record<string, unknown> | null;
};

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE = process.env.OPENROUTER_BASE_URL || 'https://api.openrouter.ai';
const ENV_DEFAULT_MODEL = process.env.OPENROUTER_DEFAULT_MODEL;
const FREE_LAST_RESORT = 'meta-llama/llama-3.1-8b-instruct:free';

/** Resolves which model to use. Explicit caller/tenant override wins; otherwise picks best live free model. Never throws. */
async function resolveModel(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  // Prefer Google AI when configured — more reliable, generous free tier
  if (isGoogleAIConfigured()) return getGoogleAIModel();
  try {
    const best = await getBestFreeModel();
    if (best) return best;
  } catch {}
  return ENV_DEFAULT_MODEL || FREE_LAST_RESORT;
}

function parseAssistantJSON(content: string | null) {
  if (!content) return null;
  const trimmed = content.trim();
  // If it looks like pure JSON, try parse directly
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to regex extraction
    }
  }
  // Extract the first {...} block - many LLMs embed JSON inside text
  const m = trimmed.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

export async function callOpenRouter(messages: Array<{ role: string; content: string }>, model?: string, retries = 2) {
  let resolvedModel = await resolveModel(model);

  // Route to Google AI if model is Gemini and key is configured
  if (isGeminiModel(resolvedModel) && isGoogleAIConfigured()) {
    if (process.env.BOOKA_REQUIRE_EXACT_AI_COSTS === 'true') {
      throw new Error('exact_ai_cost_unavailable_google_fallback_disabled');
    }
    try {
      return await callGoogleAI(messages, resolvedModel, retries);
    } catch (err) {
      defaultLogger.warn('Google AI failed, falling back to OpenRouter', { error: String(err) });
      resolvedModel = ENV_DEFAULT_MODEL || FREE_LAST_RESORT;
    }
  }

  if (!OPENROUTER_KEY) throw new Error('OPENROUTER_API_KEY not set');
  // Resolve once before the retry loop (already resolved above)
  let attempt = 0;
  let lastErr: unknown = null;
  while (attempt <= retries) {
    try {
      const res = await fetchWithTimeout(`${OPENROUTER_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENROUTER_KEY}`
        },
        body: JSON.stringify({ model: resolvedModel, messages, temperature: 0.0, max_tokens: 1024 }),
        timeoutMs: 15_000,
      });
      if (!res.ok) {
        const txt = await res.text();
        defaultLogger.error('OpenRouter API error', { status: res.status, body: txt.slice(0, 200) });
        throw new Error(`LLM service error (${res.status})`);
      }
      const json = await res.json();
      const usage = json?.usage ?? null;
      return { json, usage };
    } catch (err) {
      lastErr = err;
      // Exponential backoff with small jitter
      const base = 250;
      const backoff = Math.pow(2, attempt) * base + Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, backoff));
      attempt += 1;
      // On last retry: try env fallback model first, then second-ranked free model
      if (attempt === retries) {
        if (process.env.OPENROUTER_FALLBACK_MODEL) {
          resolvedModel = process.env.OPENROUTER_FALLBACK_MODEL;
        } else {
          try {
            const { models } = await getFreeModels();
            const second = rankFreeModels(models)[1]?.id;
            if (second && second !== resolvedModel) resolvedModel = second;
          } catch {}
        }
      }
    }
  }
  throw lastErr;
}

function normalizeUsage(usage: unknown, _model: string) {
  const normalized: Record<string, unknown> = { raw: usage ?? null };
  if (!usage) return normalized;
  const u = usage as Record<string, unknown> | null;
  normalized.model = _model || null;
  const total_tokens = (typeof u?.['total_tokens'] === 'number'
    ? (u!['total_tokens'] as number)
    : typeof u?.['total'] === 'number'
      ? (u!['total'] as number)
      : typeof u?.['tokens'] === 'number'
        ? (u!['tokens'] as number)
        : typeof u?.['token_count'] === 'number'
          ? (u!['token_count'] as number)
          : undefined);
  const prompt_tokens = typeof u?.['prompt_tokens'] === 'number' ? (u!['prompt_tokens'] as number) : undefined;
  const completion_tokens = typeof u?.['completion_tokens'] === 'number' ? (u!['completion_tokens'] as number) : undefined;
  const tokens = typeof total_tokens === 'number' ? total_tokens : ((prompt_tokens || 0) + (completion_tokens || 0));
  normalized.total_tokens = typeof tokens === 'number' ? tokens : null;
  normalized.prompt_tokens = prompt_tokens ?? null;
  normalized.completion_tokens = completion_tokens ?? null;
  normalized.cached_tokens = typeof u?.['prompt_tokens_details'] === 'object'
    ? ((u?.['prompt_tokens_details'] as Record<string, unknown>)?.['cached_tokens'] as number | undefined) ?? null
    : null;
  normalized.reasoning_tokens = typeof u?.['completion_tokens_details'] === 'object'
    ? ((u?.['completion_tokens_details'] as Record<string, unknown>)?.['reasoning_tokens'] as number | undefined) ?? null
    : null;

  normalized.cost_source = 'provider_response';
  try {
    const directCost = typeof u?.['cost'] === 'number' ? (u!['cost'] as number) : null;
    if (typeof directCost === 'number' && Number.isFinite(directCost) && directCost >= 0) {
      normalized.provider_cost_credits = Number(directCost.toFixed(6));
      normalized.provider_cost_currency = 'usd';
      normalized.cost_status = 'exact';
    } else if (typeof u?.['cost_details'] === 'object') {
      const costDetails = u?.['cost_details'] as Record<string, unknown>;
      const upstreamInferenceCost = typeof costDetails?.['upstream_inference_cost'] === 'number'
        ? (costDetails['upstream_inference_cost'] as number)
        : null;
      if (typeof upstreamInferenceCost === 'number' && Number.isFinite(upstreamInferenceCost) && upstreamInferenceCost >= 0) {
        normalized.provider_cost_credits = Number(upstreamInferenceCost.toFixed(6));
        normalized.provider_cost_currency = 'usd';
        normalized.cost_status = 'exact';
      } else {
        normalized.provider_cost_credits = null;
        normalized.provider_cost_currency = 'usd';
        normalized.cost_status = 'unknown';
      }
    } else {
      normalized.provider_cost_credits = null;
      normalized.provider_cost_currency = 'usd';
      normalized.cost_status = 'unknown';
    }
  } catch {
    normalized.provider_cost_credits = null;
    normalized.provider_cost_currency = 'usd';
    normalized.cost_status = 'unknown';
  }
  return normalized;
}

export async function classifyIntentWithOpenRouter(text: string, model?: string, context?: { services?: string[] }) {
  if (text.length > 5_000) throw new Error('Input too long for intent classification');
  const tracer = trace.getTracer('boka');
  const span = tracer.startSpan('llm.classifyIntent', { attributes: { 'llm.model': model ?? 'auto' } });
  const startHr = process.hrtime.bigint();
  const servicesHint = context?.services?.length
    ? `\nKnown services for this business: ${context.services.join(', ')}.`
    : '';
  const system = `You are an intent classifier. Return ONLY a JSON object with keys: intent (booking,reschedule,cancel,inquiry,unknown), confidence (0-1 number), entities (object).${servicesHint}`;
  const user = `Message: "${text.replace(/"/g, '\\"')}"`;
  const { json: j } = await callOpenRouter([{ role: 'system', content: system }, { role: 'user', content: user }], model);
  const assistant = j?.choices?.[0]?.message?.content || j?.choices?.[0]?.text || null;
  const parsed = parseAssistantJSON(assistant);
  if (!parsed) throw new Error('No JSON intent detected from LLM');
  const endHr = process.hrtime.bigint();
  const durationSeconds = Number(endHr - startHr) / 1e9;
  try {
    llmCallDuration.observe(durationSeconds);
    span.setAttribute('duration.seconds', durationSeconds);
    span.setAttribute('llm.intent', parsed.intent || 'unknown');
  } catch {}
  span.end();
  return parsed as { intent: string; confidence?: number; entities?: Record<string, unknown> };
}

export async function generateReplyFromPrompt(promptObject: unknown, model?: string) : Promise<LLMReply> {
  const serialized = JSON.stringify(promptObject);
  if (serialized.length > 50_000) throw new Error('Prompt object too large');
  const tracer = trace.getTracer('boka');
  const span = tracer.startSpan('llm.generateReply', { attributes: { 'llm.model': model ?? 'auto' } });
  const startHr = process.hrtime.bigint();
  const tc = (promptObject as Record<string, unknown>)?.['tenantContext'] as Record<string, unknown> ?? {};
  const businessName = (tc['tenantName'] as string) || (tc['name'] as string) || 'this business';
  const toneConfig = tc['toneConfig'] as Record<string, unknown> | undefined ?? tc['tone_config'] as Record<string, unknown> | undefined;
  const tone = (toneConfig?.['tone'] as string) || 'friendly and professional';
  const servicesList = Array.isArray(tc['services']) && (tc['services'] as Array<{ name: string }>).length
    ? (tc['services'] as Array<{ name: string }>).map((s) => s.name).join(', ')
    : '';
  const hoursSummary = tc['businessHours']
    ? `Business hours: ${JSON.stringify(tc['businessHours'])}.`
    : '';

  const system = [
    `You are the AI booking assistant for ${businessName}${tc['industry'] ? ` (${tc['industry'] as string})` : ''}.`,
    `Tone: ${tone}.`,
    servicesList ? `Services offered: ${servicesList}.` : '',
    hoursSummary,
    toneConfig?.['greeting'] ? `Greeting style: ${toneConfig['greeting'] as string}.` : '',
    'If a FAQ answers the customer\'s question, use that answer directly.',
    'Given the customer message and conversation history, return a JSON object with keys:',
    `  reply_text: your response (written in the voice of ${businessName})`,
    '  action: one of none | create_reservation | update_reservation | cancel_reservation | ask_followup',
    '  data: object with any extracted data',
    'Only return valid JSON.',
  ].filter(Boolean).join('\n');
  // Sanitize PII from promptObject where possible
  let safePrompt = promptObject;
  try {
    // only attempt shallow sanitization to avoid mutating original
    const copy = JSON.parse(JSON.stringify(promptObject));
    // redact messages array if present
    if (copy && Array.isArray(copy.messages)) {
      copy.messages = copy.messages.map((m: string) => (typeof m === 'string' ? m.replace(/\+?\d[\d\s().-]{6,}\d/g, '[REDACTED_PHONE]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]') : m));
    }
    // redact tenantContext.faqs if present
    if (copy && copy.tenantContext && Array.isArray(copy.tenantContext.faqs)) {
      copy.tenantContext.faqs = copy.tenantContext.faqs.map((f: { question: unknown; answer: unknown }) => ({
        question: typeof f.question === 'string' ? f.question.replace(/\+?\d[\d\s().-]{6,}\d/g, '[REDACTED_PHONE]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]') : f.question,
        answer: typeof f.answer === 'string' ? f.answer.replace(/\+?\d[\d\s().-]{6,}\d/g, '[REDACTED_PHONE]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]') : f.answer
      }));
    }
    safePrompt = copy;
  } catch {}
  const user = `PromptObject: ${JSON.stringify(safePrompt)}`;
  const { json: j, usage } = await callOpenRouter([{ role: 'system', content: system }, { role: 'user', content: user }], model, 2);
  const assistant = j?.choices?.[0]?.message?.content || j?.choices?.[0]?.text || null;
  const parsed = parseAssistantJSON(assistant);
  if (!parsed) {
    // If we couldn't extract JSON, try to fall back to a safe reply using the raw assistant text
    const fallback: LLMReply = { reply_text: typeof assistant === 'string' ? assistant : '', action: 'none' };
    fallback._llm_usage = normalizeUsage(usage, model ?? '');
    return fallback;
  }

  const VALID_ACTIONS = new Set(['none', 'create_reservation', 'update_reservation', 'cancel_reservation', 'ask_followup']);
  const action = VALID_ACTIONS.has(parsed.action) ? (parsed.action as LLMReply['action']) : 'none';

  // Ensure shape
  const out: LLMReply = {
    reply_text: typeof (parsed.reply_text ?? parsed.text ?? parsed.message) === 'string' ? (parsed.reply_text ?? parsed.text ?? parsed.message) : '',
    action,
    data: parsed.data ?? parsed.payload ?? parsed.details ?? undefined
  };
  out._llm_usage = normalizeUsage(usage, model ?? '');

  // Lightweight logging for observability
  try {
    defaultLogger.info('LLM reply', { action: out.action, tokens: out._llm_usage?.['total_tokens'] ?? null, provider_cost: out._llm_usage?.['provider_cost_credits'] ?? null });
  } catch {}

  const endHr = process.hrtime.bigint();
  const durationSeconds = Number(endHr - startHr) / 1e9;
  try {
    llmCallDuration.observe(durationSeconds);
    span.setAttribute('duration.seconds', durationSeconds);
    span.setAttribute('llm.action', out.action);
    span.setAttribute('llm.tokens', out._llm_usage?.['total_tokens'] as number | undefined || 0);
    if (typeof out._llm_usage?.['provider_cost_credits'] === 'number') span.setAttribute('llm.provider_cost_credits', out._llm_usage?.['provider_cost_credits'] as number);
  } catch {}
  span.end();
  return out;
}

const OpenRouter = { classifyIntentWithOpenRouter, generateReplyFromPrompt };
export default OpenRouter;
