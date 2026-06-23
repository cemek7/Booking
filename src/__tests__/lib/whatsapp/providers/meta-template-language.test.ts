import { MetaAdapter } from '@/lib/whatsapp/providers/meta';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import type { ProviderConfig } from '@/lib/whatsapp/providers/types';

jest.mock('@/lib/fetchWithTimeout', () => ({
  fetchWithTimeout: jest.fn(),
}));

const mockFetch = fetchWithTimeout as jest.MockedFunction<typeof fetchWithTimeout>;

const TEST_CONFIG: ProviderConfig = {
  provider: 'meta',
  baseUrl: 'https://graph.facebook.com/v25.0',
  apiKey: 'META_TOKEN',
  instanceName: '1234567890',
};

function makeOkResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
    text: async () => JSON.stringify(json),
  } as unknown as Response;
}

describe('MetaAdapter.sendTemplateMessage language', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(makeOkResponse({ messages: [{ id: 'wamid.1' }] }));
  });

  it('threads the explicit template language code into the request payload', async () => {
    const adapter = new MetaAdapter(TEST_CONFIG);

    await adapter.sendTemplateMessage('2348012345678', 'tpl_name', [{ default: 'X' }], 'en');

    const callOptions = mockFetch.mock.calls[0][1] as RequestInit & { body?: string };
    const body = JSON.parse(callOptions.body ?? '{}');

    expect(body.template.language.code).toBe('en');
  });

  it('defaults to en_US when no language is provided', async () => {
    const adapter = new MetaAdapter(TEST_CONFIG);

    await adapter.sendTemplateMessage('2348012345678', 'tpl_name', [{ default: 'X' }]);

    const callOptions = mockFetch.mock.calls[0][1] as RequestInit & { body?: string };
    const body = JSON.parse(callOptions.body ?? '{}');

    expect(body.template.language.code).toBe('en_US');
  });
});
