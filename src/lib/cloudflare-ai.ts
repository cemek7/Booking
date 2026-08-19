import { defaultLogger } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';
export const CLOUDFLARE_AI_DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct';

type ChatMessage = { role: string; content: string };

export function isCloudflareAIConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_API_TOKEN);
}

export function getCloudflareAIModel(): string {
  return process.env.CLOUDFLARE_AI_DEFAULT_MODEL || CLOUDFLARE_AI_DEFAULT_MODEL;
}

/**
 * Calls Cloudflare Workers AI through its OpenAI-compatible Chat Completions API.
 * A Cloudflare API token with Workers AI permissions and an account ID are required.
 */
export async function callCloudflareAI(
  messages: ChatMessage[],
  model?: string,
  retries = 2
): Promise<{ json: unknown; usage: unknown }> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_AI_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_API_TOKEN must be set');
  }

  const baseUrl = (process.env.CLOUDFLARE_AI_BASE_URL || CLOUDFLARE_API_BASE).replace(/\/$/, '');
  const currentModel = model || getCloudflareAIModel();
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID;
      const res = await fetchWithTimeout(
        `${baseUrl}/accounts/${encodeURIComponent(accountId)}/ai/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiToken}`,
            ...(gatewayId ? { 'cf-aig-gateway-id': gatewayId } : {}),
          },
          body: JSON.stringify({ model: currentModel, messages, temperature: 0, max_tokens: 1024 }),
          timeoutMs: 15_000,
        }
      );

      const payload = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (!res.ok || payload?.success === false) {
        const error = payload?.errors ?? payload ?? `HTTP ${res.status}`;
        defaultLogger.error('Cloudflare AI API error', { status: res.status, error, model: currentModel });
        throw new Error(`Cloudflare AI error (${res.status})`);
      }

      // Cloudflare's API envelope places the OpenAI-shaped response in `result`.
      const json = (payload?.result ?? payload) as Record<string, unknown>;
      return { json, usage: json?.usage ?? payload?.usage ?? null };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        const backoff = (2 ** attempt) * 250 + Math.floor(Math.random() * 100);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  throw lastError ?? new Error('Cloudflare AI request failed');
}
