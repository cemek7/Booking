import { callCloudflareAI } from '@/lib/cloudflare-ai';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

jest.mock('@/lib/fetchWithTimeout', () => ({ fetchWithTimeout: jest.fn() }));

const mockFetchWithTimeout = jest.mocked(fetchWithTimeout);

describe('Cloudflare Workers AI client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      CLOUDFLARE_ACCOUNT_ID: 'account-123',
      CLOUDFLARE_AI_API_TOKEN: 'token-123',
      CLOUDFLARE_AI_DEFAULT_MODEL: '@cf/meta/llama-3.1-8b-instruct',
    };
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: { choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 12 } },
      }),
    } as Response);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('uses the OpenAI-compatible Cloudflare endpoint and unwraps its result', async () => {
    const result = await callCloudflareAI([{ role: 'user', content: 'Hello' }], undefined, 0);

    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/account-123/ai/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
        body: JSON.stringify({
          model: '@cf/meta/llama-3.1-8b-instruct',
          messages: [{ role: 'user', content: 'Hello' }],
          temperature: 0,
          max_tokens: 1024,
        }),
      })
    );
    expect(result).toEqual({
      json: { choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 12 } },
      usage: { total_tokens: 12 },
    });
  });
});
