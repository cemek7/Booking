import { defaultLogger } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

// --- Types ---

export interface OpenRouterModelPricing {
  prompt: string;
  completion: string;
  image?: string;
  request?: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing: OpenRouterModelPricing;
  top_provider?: { context_length?: number; max_completion_tokens?: number };
}

export interface FreeModelsResult {
  models: OpenRouterModel[];
  fetched_at: string;
  cached: boolean;
  count: number;
  best_model: string | null;
}

// Ordered preference list: highest quality/speed first.
// Models not in this list rank by context_length descending.
export const PREFERRED_FREE_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'meta-llama/llama-3.1-70b-instruct:free',
  'deepseek/deepseek-r1:free',
  'google/gemini-2.0-flash-exp:free',
  'google/gemma-3-27b-it:free',
  'meta-llama/llama-3.1-8b-instruct:free',
  'mistralai/mistral-7b-instruct:free',
  'microsoft/phi-3-mini-128k-instruct:free',
];

export function rankFreeModels(models: OpenRouterModel[]): OpenRouterModel[] {
  const preferred: Array<{ model: OpenRouterModel; rank: number }> = [];
  const unknown: OpenRouterModel[] = [];
  for (const m of models) {
    const idx = PREFERRED_FREE_MODELS.indexOf(m.id);
    if (idx !== -1) preferred.push({ model: m, rank: idx });
    else unknown.push(m);
  }
  preferred.sort((a, b) => a.rank - b.rank);
  unknown.sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0));
  return [...preferred.map((p) => p.model), ...unknown];
}

// --- In-memory cache (module-level singleton, per Node.js process) ---

interface ModelCache {
  models: OpenRouterModel[];
  expiresAt: number;
  fetchedAt: string;
}

let _cache: ModelCache | null = null;

const MODELS_API_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes
const FETCH_TIMEOUT_MS = 15_000;

// --- Core fetching logic ---

async function fetchFreeModelsFromAPI(): Promise<OpenRouterModel[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');

  const res = await fetchWithTimeout(MODELS_API_URL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    timeoutMs: FETCH_TIMEOUT_MS,
  });

  if (!res.ok) {
    const body = await res.text();
    defaultLogger.error('OpenRouter models API error', { status: res.status, body: body.slice(0, 200) });
    throw new Error(`OpenRouter models API returned ${res.status}`);
  }

  const json = await res.json() as { data?: OpenRouterModel[] };
  if (!Array.isArray(json.data)) throw new Error('Unexpected response shape from OpenRouter models API');

  const free = json.data.filter(
    (m) => m.pricing?.prompt === '0' && m.pricing?.completion === '0'
  );

  defaultLogger.info('OpenRouter free models fetched', { total: json.data.length, free: free.length });
  return free;
}

// --- Public API ---

/**
 * Returns the list of free OpenRouter models (pricing.prompt === "0" AND pricing.completion === "0"),
 * using a 60-minute in-memory cache. Pass forceRefresh=true to bypass the cache.
 */
export async function getFreeModels(forceRefresh = false): Promise<FreeModelsResult> {
  const now = Date.now();
  if (!forceRefresh && _cache && _cache.expiresAt > now) {
    return {
      models: _cache.models,
      fetched_at: _cache.fetchedAt,
      cached: true,
      count: _cache.models.length,
      best_model: rankFreeModels(_cache.models)[0]?.id ?? null,
    };
  }

  const models = await fetchFreeModelsFromAPI();
  const fetchedAt = new Date().toISOString();
  _cache = { models, expiresAt: Date.now() + CACHE_TTL_MS, fetchedAt };
  const bestModel = rankFreeModels(models)[0]?.id ?? null;
  return { models, fetched_at: fetchedAt, cached: false, count: models.length, best_model: bestModel };
}

/** Returns the best (highest ranked) free model ID, null if none available or API is down. Never throws. */
export async function getBestFreeModel(): Promise<string | null> {
  try {
    const result = await getFreeModels();
    return result.best_model;
  } catch { return null; }
}

/** Returns true/false if the given model ID is in the free list, null if the API is unavailable. Never throws. */
export async function isModelFree(modelId: string): Promise<boolean | null> {
  try {
    const result = await getFreeModels();
    return result.models.some((m) => m.id === modelId);
  } catch { return null; }
}

/** Returns the count of free models, null if the API is unavailable. Never throws. */
export async function getFreeModelCount(): Promise<number | null> {
  try {
    const result = await getFreeModels();
    return result.count;
  } catch { return null; }
}
