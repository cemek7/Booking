import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const getAIProvider = jest.fn();

jest.mock('@/lib/logger', () => ({ defaultLogger: { warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: jest.fn(() => ({})) }));
jest.mock('@/lib/llmUsageTracker', () => ({ canMakeLLMRequest: jest.fn().mockResolvedValue(true), recordLLMUsage: jest.fn() }));
jest.mock('@/lib/google-ai', () => ({ isGoogleAIConfigured: jest.fn(() => true), getGoogleAIModel: jest.fn(() => 'gemini-test') }));
jest.mock('@/lib/cloudflare-ai', () => ({ isCloudflareAIConfigured: jest.fn(() => false), getCloudflareAIModel: jest.fn(() => '@cf/test-model') }));
jest.mock('@/lib/ai/providers', () => ({ getAIProvider }));
jest.mock('@/lib/billing/ai-wallet', () => ({
  estimatePromptTokens: jest.fn(() => 200),
  withTenantWalletSpend: jest.fn(async (_supabase, _tenantId, _options, execute) => execute()),
}));

import { detectIntent } from '@/lib/intentDetector';

describe('intent detector provider alignment', () => {
  const original = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WHATSAPP_V2_AI_PROVIDER = 'openrouter';
    process.env.WHATSAPP_V2_DISABLE_GOOGLE = 'true';
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_DEFAULT_MODEL = 'openai/gpt-4o-mini';
    process.env.OPENROUTER_FALLBACK_MODEL = '';
    process.env.OPENROUTER_V2_FALLBACK_MODELS = '';
    getAIProvider.mockReturnValue({
      complete: jest.fn().mockResolvedValue({
        json: { choices: [{ message: { content: '{"intent":"inquiry","confidence":0.8,"entities":[]}' } }] },
        usage: null,
      }),
    });
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('uses the configured v2 OpenRouter policy even when a Google key exists', async () => {
    const result = await detectIntent('Can you explain what your business offers?', undefined, 'tenant-1');

    expect(result.intent).toBe('inquiry');
    expect(getAIProvider).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'openrouter',
      openRouterModel: 'openai/gpt-4o-mini',
      disableGoogle: true,
    }));
    const provider = getAIProvider.mock.results[0]?.value as { complete: jest.Mock };
    expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai/gpt-4o-mini' }));
  });
});
