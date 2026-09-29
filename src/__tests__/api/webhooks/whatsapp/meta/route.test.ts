import { createHmac } from 'crypto';

const mockResolveRoute = jest.fn();
const mockResolveIncoming = jest.fn();
const mockEnsureConversation = jest.fn();
const mockEnsureCustomerIdentity = jest.fn();
const mockEnsureThread = jest.fn();
const mockIngest = jest.fn();

jest.mock('@/lib/whatsapp/v2/routeSession', () => ({
  resolveWhatsAppRoute: (...args: unknown[]) => mockResolveRoute(...args),
}));
jest.mock('@/lib/whatsapp/v2/identityResolver', () => ({
  resolveIncoming: (...args: unknown[]) => mockResolveIncoming(...args),
}));
jest.mock('@/lib/whatsapp/v2/conversationState', () => ({
  ensureConversation: (...args: unknown[]) => mockEnsureConversation(...args),
}));
jest.mock('@/lib/customers/channelIdentity', () => ({
  ensureCustomerChannelIdentity: (...args: unknown[]) => mockEnsureCustomerIdentity(...args),
}));
jest.mock('@/lib/whatsapp/v2/conversationThread', () => ({
  ensureActiveThread: (...args: unknown[]) => mockEnsureThread(...args),
}));
jest.mock('@/lib/whatsapp/v2/queueBatch', () => ({
  ingestConversationMessage: (...args: unknown[]) => mockIngest(...args),
}));
jest.mock('@/lib/whatsapp/v2/deliverability/metaQualityWebhook', () => ({ ingestQualityWebhook: jest.fn() }));
jest.mock('@/lib/billing/messageWallet', () => ({
  resolveChargeTenantByWamid: jest.fn(), settleOutboundMessage: jest.fn(),
}));

const operations: Array<{ table: string; operation: string; payload?: unknown }> = [];

function buildAdmin() {
  let table = '';
  const chain: Record<string, unknown> = {
    from(name: string) { table = name; return chain; },
    select() { return chain; },
    eq() { return chain; },
    insert(payload: unknown) { operations.push({ table, operation: 'insert', payload }); return chain; },
    upsert(payload: unknown) { operations.push({ table, operation: 'upsert', payload }); return chain; },
    maybeSingle() {
      if (table === 'whatsapp_configurations') return Promise.resolve({ data: null, error: null });
      if (table === 'tenants') return Promise.resolve({ data: { v2_enabled: true }, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    single() {
      if (table === 'chats') return Promise.resolve({ data: { id: 'chat-1' }, error: null });
      if (table === 'messages') return Promise.resolve({ data: { id: '11111111-1111-4111-8111-111111111111' }, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    },
  };
  return chain;
}

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(() => buildAdmin()),
}));

import { POST } from '@/app/api/webhooks/whatsapp/meta/route';

const APP_SECRET = 'meta-test-secret';

function request(body: string) {
  const signature = `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
  return {
    text: async () => body,
    headers: { get: (name: string) => name.toLowerCase() === 'x-hub-signature-256' ? signature : null },
  } as never;
}

describe('Meta shared-gateway routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    operations.length = 0;
    process.env.NODE_ENV = 'production';
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    process.env.META_SHARED_GATEWAY_PHONE_NUMBER_ID = 'gateway-phone-id';
    mockResolveRoute.mockResolvedValue({
      status: 'routed', tenantId: 'tenant-b', source: 'routing_code', strippedMessage: 'I need braids',
    });
    mockResolveIncoming.mockResolvedValue({
      tenantId: 'tenant-b', role: 'customer', routingCodeFound: false,
      tenantUserId: null, userId: null, strippedMessage: 'I need braids',
    });
    mockEnsureCustomerIdentity.mockResolvedValue({
      identityId: 'identity-wa', customerId: 'customer-wa', created: true,
    });
    mockEnsureConversation.mockResolvedValue({ id: 'conversation-wa' });
    mockEnsureThread.mockResolvedValue({ id: 'thread-wa' });
    mockIngest.mockResolvedValue('queue-wa');
  });

  it('routes before tenant-scoped conversation and queue writes', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: 'gateway-phone-id', display_phone_number: '+2348000000000' },
        messages: [{ from: '+2348111111111', id: 'wamid.1', timestamp: '1790596800', type: 'text', text: { body: 'BETY42 I need braids' } }],
      } }] }],
    });

    const response = await POST(request(body));

    expect(response.status).toBe(200);
    expect(mockResolveRoute).toHaveBeenCalledWith(expect.objectContaining({
      externalId: '+2348111111111', gatewayPhoneNumberId: 'gateway-phone-id',
      messageText: 'BETY42 I need braids', dedicatedTenantId: undefined,
    }));
    expect(mockResolveIncoming).toHaveBeenCalledWith(
      'whatsapp', '+2348111111111', 'I need braids', 'tenant-b',
    );
    expect(mockEnsureCustomerIdentity).toHaveBeenCalledWith({
      tenantId: 'tenant-b', channel: 'whatsapp', externalId: '+2348111111111',
    });
    expect(mockEnsureConversation).toHaveBeenCalledWith(
      '+2348111111111', 'tenant-b', 'customer', 'whatsapp', 'customer-wa',
    );
    expect(mockEnsureThread).toHaveBeenCalledWith({
      tenantId: 'tenant-b', customerId: 'customer-wa', channelIdentityId: 'identity-wa',
      channel: 'whatsapp', conversationId: 'conversation-wa',
    });
    expect(mockIngest).toHaveBeenCalledWith(expect.objectContaining({
      webhookProvider: 'meta', webhookExternalId: 'gateway-phone-id:wamid.1', tenantId: 'tenant-b',
      conversationId: 'conversation-wa', threadId: 'thread-wa', channel: 'whatsapp',
      fromNumber: '+2348111111111', content: 'I need braids', providerMessageId: 'wamid.1',
    }));
    expect(operations.find((entry) => entry.table === 'whatsapp_message_queue')).toBeUndefined();
  });
});
