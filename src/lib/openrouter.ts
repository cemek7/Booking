import { trace } from '@opentelemetry/api';
import { llmCallDuration } from './metrics';
type LLMReply = {
  reply_text: string;
  action: 'none' | 'create_reservation' | 'update_reservation' | 'cancel_reservation' | 'ask_followup';
  data?: Record<string, unknown>;
  // _llm_usage will be injected when available
  _llm_usage?: Record<string, unknown> | null;
};

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE = process.env.OPENROUTER_BASE_URL || 'https://api.openrouter.ai';
const DEFAULT_MODEL = process.env.OPENROUTER_DEFAULT_MODEL || 'gpt-4o-mini';

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

async function callOpenRouter(messages: Array<{ role: string; content: string }>, model = DEFAULT_MODEL, retries = 2) {
  if (!OPENROUTER_KEY) throw new Error('OPENROUTER_API_KEY not set');
  let attempt = 0;
  let lastErr: unknown = null;
  while (attempt <= retries) {
    try {
      const res = await fetch(`${OPENROUTER_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENROUTER_KEY}`
        },
        body: JSON.stringify({ model, messages, temperature: 0.0, max_tokens: 1024 })
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`OpenRouter error ${res.status}: ${txt}`);
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
      // Allow a fallback model on the last attempt if provided via env
      if (attempt === retries && process.env.OPENROUTER_FALLBACK_MODEL) {
        model = process.env.OPENROUTER_FALLBACK_MODEL;
      }
    }
  }
  throw lastErr;
}

function normalizeUsage(usage: unknown, model: string) {
  const normalized: Record<string, unknown> = { raw: usage ?? null };
  if (!usage) return normalized;
  const u = usage as Record<string, unknown> | null;
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

  // Compute estimated cost using env map OPENROUTER_MODEL_TOKEN_RATE
  try {
    const ratesJson = process.env.OPENROUTER_MODEL_TOKEN_RATE || ''; // 'gpt-4o-mini:0.000002,gpt-4o:0.000003'
    const rateMap: Record<string, number> = {};
    if (ratesJson) {
      for (const kv of ratesJson.split(',')) {
        const [k, v] = kv.split(':');
        const n = Number(v);
        if (k && !isNaN(n)) rateMap[k.trim()] = n;
      }
    }
    const defaultRate = Number(process.env.OPENROUTER_DEFAULT_TOKEN_RATE) || 0;
    const rate = rateMap[model] ?? defaultRate;
    normalized.estimated_cost = (rate > 0 && typeof tokens === 'number') ? tokens * rate : null;
  } catch {
    normalized.estimated_cost = null;
  }
  return normalized;
}

export async function classifyIntentWithOpenRouter(text: string, model = DEFAULT_MODEL) {
  const tracer = trace.getTracer('boka');
  const span = tracer.startSpan('llm.classifyIntent', { attributes: { 'llm.model': model } });
  const startHr = process.hrtime.bigint();
  const system = `You are an intent classifier. Return ONLY a JSON object with keys: intent (booking,reschedule,cancel,inquiry,unknown), confidence (0-1 number), entities (object).`;
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

export async function generateReplyFromPrompt(promptObject: unknown, model = DEFAULT_MODEL) : Promise<LLMReply> {
  const tracer = trace.getTracer('boka');
  const span = tracer.startSpan('llm.generateReply', { attributes: { 'llm.model': model } });
  const startHr = process.hrtime.bigint();
  const system = `You are Booka assistant. Given tenant context, recent messages, and intent, return a JSON object with keys: reply_text, action (none|create_reservation|update_reservation|cancel_reservation|ask_followup), and data (object). Only return valid JSON.`;
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
    fallback._llm_usage = normalizeUsage(usage, model);
    return fallback;
  }

  // Ensure shape
  const out: LLMReply = {
    reply_text: typeof (parsed.reply_text ?? parsed.text ?? parsed.message) === 'string' ? (parsed.reply_text ?? parsed.text ?? parsed.message) : '',
    action: (parsed.action as LLMReply['action']) ?? 'none',
    data: parsed.data ?? parsed.payload ?? parsed.details ?? undefined
  };
  out._llm_usage = normalizeUsage(usage, model);

  // Lightweight logging for observability
  try {
    console.log('OpenRouter reply', { action: out.action, tokens: out._llm_usage?.['total_tokens'] ?? null, estimated_cost: out._llm_usage?.['estimated_cost'] ?? null });
  } catch {}

  const endHr = process.hrtime.bigint();
  const durationSeconds = Number(endHr - startHr) / 1e9;
  try {
    llmCallDuration.observe(durationSeconds);
    span.setAttribute('duration.seconds', durationSeconds);
    span.setAttribute('llm.action', out.action);
    span.setAttribute('llm.tokens', out._llm_usage?.['total_tokens'] as number | undefined || 0);
    if (typeof out._llm_usage?.['estimated_cost'] === 'number') span.setAttribute('llm.estimated_cost', out._llm_usage?.['estimated_cost'] as number);
  } catch {}
  span.end();
  return out;
}

const OpenRouter = { classifyIntentWithOpenRouter, generateReplyFromPrompt };
export default OpenRouter;
