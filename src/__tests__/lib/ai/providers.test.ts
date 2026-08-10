import { getAIProvider } from '@/lib/ai/providers';
import { callCloudflareAI } from '@/lib/cloudflare-ai';

jest.mock('@/lib/cloudflare-ai', () => ({
  callCloudflareAI: jest.fn(),
  getCloudflareAIModel: jest.fn(() => '@cf/meta/llama-3.1-8b-instruct'),
  isCloudflareAIConfigured: jest.fn(() => true),
}));
jest.mock('@/lib/google-ai', () => ({ callGoogleAI: jest.fn() }));
jest.mock('@/lib/openrouter', () => ({ callOpenRouter: jest.fn() }));

describe('AI provider selection', () => {
  it('selects Cloudflare explicitly even when Google fallback is disabled', async () => {
    jest.mocked(callCloudflareAI).mockResolvedValue({ json: { choices: [] }, usage: null });

    const result = await getAIProvider({
      mode: 'cloudflare',
      cloudflareModel: '@cf/meta/llama-3.1-8b-instruct',
      disableGoogle: true,
    }).complete({
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'ignored-by-cloudflare-config',
    });

    expect(callCloudflareAI).toHaveBeenCalledWith(
      [{ role: 'user', content: 'Hello' }],
      '@cf/meta/llama-3.1-8b-instruct',
      1
    );
    expect(result).toEqual({ json: { choices: [] }, usage: null });
  });
});
