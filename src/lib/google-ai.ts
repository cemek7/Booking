import { defaultLogger } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

export const GOOGLE_AI_FREE_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];

export const FLASH_LITE_MODEL = 'gemini-2.0-flash-lite';
export const FLASH_MODEL = 'gemini-2.0-flash';

const GOOGLE_AI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

export function isGoogleAIConfigured(): boolean {
  return !!process.env.GOOGLE_AI_API_KEY;
}

export function getGoogleAIModel(): string {
  return process.env.GOOGLE_AI_DEFAULT_MODEL || GOOGLE_AI_FREE_MODELS[0];
}

/** Returns true if the given model ID is a Gemini model (should route to Google AI). */
export function isGeminiModel(model: string): boolean {
  return model.startsWith('gemini-') || GOOGLE_AI_FREE_MODELS.includes(model);
}

/**
 * Call Google AI (Gemini) via its OpenAI-compatible endpoint.
 * Returns the same { json, usage } shape as callOpenRouter for transparent routing.
 * On last retry, cycles to the next model in GOOGLE_AI_FREE_MODELS.
 * Throws on all retries exhausted — callers should catch and fall back to OpenRouter.
 */
export async function callGoogleAI(
  messages: Array<{ role: string; content: string }>,
  model?: string,
  retries = 2
): Promise<{ json: unknown; usage: unknown }> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not set');

  let currentModel = model ?? getGoogleAIModel();
  let attempt = 0;
  let lastErr: unknown = null;

  while (attempt <= retries) {
    try {
      const res = await fetchWithTimeout(`${GOOGLE_AI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: currentModel, messages, temperature: 0.0, max_tokens: 1024 }),
        timeoutMs: 15_000,
      });
      if (!res.ok) {
        const txt = await res.text();
        defaultLogger.error('Google AI API error', { status: res.status, body: txt.slice(0, 200), model: currentModel });
        throw new Error(`Google AI error (${res.status})`);
      }
      const json = await res.json();
      const usage = (json as Record<string, unknown>)?.usage ?? null;
      return { json, usage };
    } catch (err) {
      lastErr = err;
      const backoff = Math.pow(2, attempt) * 250 + Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, backoff));
      attempt += 1;
      // On last retry, cycle to next model in the free list
      if (attempt === retries) {
        const idx = GOOGLE_AI_FREE_MODELS.indexOf(currentModel);
        const next = GOOGLE_AI_FREE_MODELS[idx + 1];
        if (next && next !== currentModel) {
          defaultLogger.info('Google AI retrying with next model', { from: currentModel, to: next });
          currentModel = next;
        }
      }
    }
  }
  throw lastErr;
}

/**
 * Convenience wrapper: calls Flash-Lite (L2) for structured JSON responses.
 * Used by the v2 pipeline for all business-specific intent parsing.
 */
export async function callFlashLite(
  prompt: string
): Promise<{ json: unknown; usage: unknown }> {
  return callGoogleAI([{ role: 'user', content: prompt }], FLASH_LITE_MODEL);
}

/**
 * Convenience wrapper: calls Flash (L3) for complex/ambiguous escalations.
 */
export async function callFlash(
  prompt: string
): Promise<{ json: unknown; usage: unknown }> {
  return callGoogleAI([{ role: 'user', content: prompt }], FLASH_MODEL);
}
