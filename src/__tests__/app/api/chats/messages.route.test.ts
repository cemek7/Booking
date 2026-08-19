import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { POST } from '@/app/api/chats/[id]/messages/route';
import { ApiError } from '@/lib/error-handling/api-error';

const mockGetTenantChannelProviderClient = jest.fn();
const mockHasMessagingConsent = jest.fn();

jest.mock('@/lib/whatsapp/providers/providerSelection', () => ({
  getTenantChannelProviderClient: (...args: unknown[]) => mockGetTenantChannelProviderClient(...args),
}));
jest.mock('@/lib/whatsapp/v2/humanTakeover', () => ({
  setHumanHandling: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/optin/messagingConsent', () => ({
  hasMessagingConsent: (...args: unknown[]) => mockHasMessagingConsent(...args),
}));

type MockOptions = {
  chatMetadata?: { channel?: 'whatsapp' | 'instagram' } | null;
  lastInboundAt?: string | null;
};

function createMockSupabase(options: MockOptions = {}) {
  let table = '';
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];

  const builder = {
    from: jest.fn((nextTable: string) => {
      table = nextTable;
      return builder;
    }),
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => {
      if (table === 'whatsapp_conversations') {
        return { data: { last_inbound_at: options.lastInboundAt ?? null }, error: null };
      }
      return { data: null, error: null };
    }),
    single: jest.fn(async () => {
      if (table === 'chats') {
        return {
          data: {
            id: 'chat-1',
            tenant_id: 'tenant-1',
            customer_phone: options.chatMetadata?.channel === 'instagram' ? 'IGSID_123' : '+2348000000000',
            metadata: options.chatMetadata ?? null,
          },
          error: null,
        };
      }

      if (table === 'messages') {
        return {
          data: { id: 'msg-1', created_at: '2026-06-25T12:00:00.000Z' },
          error: null,
        };
      }

      return { data: null, error: null };
    }),
    insert: jest.fn((payload: Record<string, unknown>) => {
      inserts.push({ table, payload });
      return builder;
    }),
  };

  return { builder, inserts };
}

function createContext(supabase: ReturnType<typeof createMockSupabase>['builder']) {
  return {
    params: { id: 'chat-1' },
    request: {
      method: 'POST',
      url: 'http://localhost:3000/api/chats/chat-1/messages',
      headers: new Headers({
        'content-type': 'application/json',
        'x-tenant-id': 'tenant-1',
      }),
      json: async () => ({ text: 'Hello there' }),
    },
    supabase,
    user: {
      id: 'user-1',
      tenantId: 'tenant-1',
    },
  };
}

describe('POST /api/chats/[id]/messages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasMessagingConsent.mockResolvedValue(false);
    mockGetTenantChannelProviderClient.mockResolvedValue({
      sendTextMessage: jest.fn().mockResolvedValue({ success: true }),
    });
  });

  it('blocks Instagram replies outside the 24-hour window', async () => {
    const { builder, inserts } = createMockSupabase({
      chatMetadata: { channel: 'instagram' },
      lastInboundAt: '2026-06-20T12:00:00.000Z',
    });

    await expect(POST(createContext(builder) as unknown as Parameters<typeof POST>[0])).rejects.toMatchObject<ApiError>({
      statusCode: 423,
      message: expect.stringContaining('Instagram replies are only allowed within 24 hours'),
    });
    expect(inserts.find((entry) => entry.table === 'messages')).toBeUndefined();
    expect(mockGetTenantChannelProviderClient).not.toHaveBeenCalled();
  });

  it('routes Instagram replies through the Instagram client when inside the 24-hour window', async () => {
    const sendTextMessage = jest.fn().mockResolvedValue({ success: true });
    mockGetTenantChannelProviderClient.mockResolvedValue({ sendTextMessage });

    const { builder, inserts } = createMockSupabase({
      chatMetadata: { channel: 'instagram' },
      lastInboundAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    });

    const response = await POST(createContext(builder) as unknown as Parameters<typeof POST>[0]);

    expect(response).toMatchObject({ ok: true, id: 'msg-1' });
    expect(mockGetTenantChannelProviderClient).toHaveBeenCalledWith('tenant-1', 'instagram');
    expect(inserts.find((entry) => entry.table === 'messages')?.payload).toMatchObject({
      tenant_id: 'tenant-1',
      chat_id: 'chat-1',
      to_number: 'IGSID_123',
      direction: 'outbound',
    });
  });

  it('blocks WhatsApp follow-up outside the reply window without consent', async () => {
    const { builder, inserts } = createMockSupabase({
      chatMetadata: { channel: 'whatsapp' },
      lastInboundAt: '2026-06-20T12:00:00.000Z',
    });

    await expect(POST(createContext(builder) as unknown as Parameters<typeof POST>[0])).rejects.toMatchObject<ApiError>({
      statusCode: 423,
      message: expect.stringContaining('requires explicit messaging consent'),
    });
    expect(inserts.find((entry) => entry.table === 'messages')).toBeUndefined();
    expect(mockGetTenantChannelProviderClient).not.toHaveBeenCalled();
  });

  it('allows WhatsApp follow-up outside the reply window when consent exists', async () => {
    mockHasMessagingConsent.mockResolvedValue(true);
    const sendTextMessage = jest.fn().mockResolvedValue({ success: true });
    mockGetTenantChannelProviderClient.mockResolvedValue({ sendTextMessage });

    const { builder, inserts } = createMockSupabase({
      chatMetadata: { channel: 'whatsapp' },
      lastInboundAt: '2026-06-20T12:00:00.000Z',
    });

    const response = await POST(createContext(builder) as unknown as Parameters<typeof POST>[0]);

    expect(response).toMatchObject({ ok: true, id: 'msg-1' });
    expect(mockGetTenantChannelProviderClient).toHaveBeenCalledWith('tenant-1', 'whatsapp');
    expect(inserts.find((entry) => entry.table === 'messages')?.payload).toMatchObject({
      tenant_id: 'tenant-1',
      chat_id: 'chat-1',
      to_number: '+2348000000000',
      direction: 'outbound',
    });
  });
});
