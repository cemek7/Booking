import { InstagramAdapter } from '@/lib/whatsapp/providers/instagram';
import { getProviderClient } from '@/lib/whatsapp/providers/index';
import type { ProviderConfig } from '@/lib/whatsapp/providers/types';

// Mock fetchWithTimeout so we can capture requests without hitting the network
jest.mock('@/lib/fetchWithTimeout', () => ({
  fetchWithTimeout: jest.fn(),
}));

import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

const mockFetch = fetchWithTimeout as jest.MockedFunction<typeof fetchWithTimeout>;

const TEST_CONFIG: ProviderConfig = {
  provider: 'instagram',
  baseUrl: 'https://graph.instagram.com/v25.0',
  apiKey: 'TID_TOKEN',
  instanceName: '17841400000000000',
};

function makeOkResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
    text: async () => JSON.stringify(json),
  } as unknown as Response;
}

function makeErrorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    json: async () => { throw new Error('not json'); },
    text: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('InstagramAdapter.sendTextMessage', () => {
  it('POSTs to the correct Instagram Messages endpoint', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({ message_id: 'm1', recipient_id: 'IGSID_1' })
    );

    const adapter = new InstagramAdapter(TEST_CONFIG);
    await adapter.sendTextMessage('IGSID_1', 'hi');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://graph.instagram.com/v25.0/17841400000000000/messages');
  });

  it('sends the correct JSON body for a text message', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({ message_id: 'm1', recipient_id: 'IGSID_1' })
    );

    const adapter = new InstagramAdapter(TEST_CONFIG);
    await adapter.sendTextMessage('IGSID_1', 'hi');

    const callOptions = mockFetch.mock.calls[0][1] as RequestInit & { body?: string };
    expect(callOptions.method).toBe('POST');
    expect(JSON.parse(callOptions.body!)).toEqual({
      recipient: { id: 'IGSID_1' },
      message: { text: 'hi' },
    });
  });

  it('sends the Authorization Bearer header', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({ message_id: 'm1', recipient_id: 'IGSID_1' })
    );

    const adapter = new InstagramAdapter(TEST_CONFIG);
    await adapter.sendTextMessage('IGSID_1', 'hi');

    const callOptions = mockFetch.mock.calls[0][1] as RequestInit & { headers?: Record<string, string> };
    expect(callOptions.headers).toMatchObject({
      Authorization: 'Bearer TID_TOKEN',
    });
  });

  it('returns { success: true, messageId } on a successful response', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({ message_id: 'm1', recipient_id: 'IGSID_1' })
    );

    const adapter = new InstagramAdapter(TEST_CONFIG);
    const result = await adapter.sendTextMessage('IGSID_1', 'hi');

    expect(result).toEqual({ success: true, messageId: 'm1' });
  });

  it('returns { success: false } on a 400 error response without throwing', async () => {
    mockFetch.mockResolvedValue(makeErrorResponse(400, 'err'));

    const adapter = new InstagramAdapter(TEST_CONFIG);
    const result = await adapter.sendTextMessage('IGSID_1', 'bad message');

    expect(result).toEqual({ success: false });
  });

  it('returns { success: false } when fetchWithTimeout throws (network error)', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const adapter = new InstagramAdapter(TEST_CONFIG);
    const result = await adapter.sendTextMessage('IGSID_1', 'hi');

    expect(result).toEqual({ success: false });
  });
});

describe('InstagramAdapter.sendMediaMessage', () => {
  it('POSTs image attachment body to the messages endpoint', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({ message_id: 'm2', recipient_id: 'IGSID_1' })
    );

    const adapter = new InstagramAdapter(TEST_CONFIG);
    const result = await adapter.sendMediaMessage(
      'IGSID_1',
      { url: 'https://example.com/photo.jpg', mimetype: 'image/jpeg' },
      'Nice photo',
      'image'
    );

    expect(result).toEqual({ success: true, messageId: 'm2' });

    const callOptions = mockFetch.mock.calls[0][1] as RequestInit & { body?: string };
    expect(callOptions.method).toBe('POST');
    expect(JSON.parse(callOptions.body!)).toEqual({
      recipient: { id: 'IGSID_1' },
      message: {
        attachment: {
          type: 'image',
          payload: { url: 'https://example.com/photo.jpg' },
        },
      },
    });
  });

  it('returns { success: false } on a non-ok response without throwing', async () => {
    mockFetch.mockResolvedValue(makeErrorResponse(403, 'forbidden'));

    const adapter = new InstagramAdapter(TEST_CONFIG);
    const result = await adapter.sendMediaMessage(
      'IGSID_1',
      { url: 'https://example.com/photo.jpg', mimetype: 'image/jpeg' }
    );

    expect(result).toEqual({ success: false });
  });
});

describe('InstagramAdapter no-op methods', () => {
  const adapter = new InstagramAdapter(TEST_CONFIG);

  it('createInstance returns { status: "configured" }', async () => {
    const result = await adapter.createInstance('https://hook.example.com', 'secret');
    expect(result).toEqual({ status: 'configured' });
  });

  it('getConnectionStatus GETs the instance username endpoint and returns connected:true on ok', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({ username: 'mybusiness', id: '17841400000000000' })
    );

    const result = await adapter.getConnectionStatus();
    expect(result).toEqual({ connected: true });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(
      'https://graph.instagram.com/v25.0/17841400000000000?fields=username'
    );
  });

  it('getConnectionStatus returns { connected: false } when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'));
    const result = await adapter.getConnectionStatus();
    expect(result).toEqual({ connected: false });
  });

  it('getQrCode returns null', async () => {
    expect(await adapter.getQrCode()).toBeNull();
  });

  it('requestPairingCode returns null', async () => {
    expect(await adapter.requestPairingCode('+15550000000')).toBeNull();
  });

  it('deleteInstance resolves without error', async () => {
    await expect(adapter.deleteInstance()).resolves.toBeUndefined();
  });
});

describe('getProviderClient factory', () => {
  it('returns an InstagramAdapter instance when provider is "instagram"', () => {
    const client = getProviderClient(TEST_CONFIG);
    expect(client).toBeInstanceOf(InstagramAdapter);
  });

  it('does NOT return InstagramAdapter for provider "meta"', () => {
    const metaConfig: ProviderConfig = { ...TEST_CONFIG, provider: 'meta' };
    const client = getProviderClient(metaConfig);
    expect(client).not.toBeInstanceOf(InstagramAdapter);
  });
});
