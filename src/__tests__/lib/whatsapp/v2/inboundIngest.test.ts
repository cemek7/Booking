const mockResolveIncoming = jest.fn();
const mockEnsureIdentity = jest.fn();
const mockEnsureConversation = jest.fn();
const mockEnsureThread = jest.fn();
const mockIngest = jest.fn();

jest.mock('@/lib/whatsapp/v2/identityResolver', () => ({
  resolveIncoming: (...args: unknown[]) => mockResolveIncoming(...args),
}));
jest.mock('@/lib/customers/channelIdentity', () => ({
  ensureCustomerChannelIdentity: (...args: unknown[]) => mockEnsureIdentity(...args),
}));
jest.mock('@/lib/whatsapp/v2/conversationState', () => ({
  ensureConversation: (...args: unknown[]) => mockEnsureConversation(...args),
}));
jest.mock('@/lib/whatsapp/v2/conversationThread', () => ({
  ensureActiveThread: (...args: unknown[]) => mockEnsureThread(...args),
}));
jest.mock('@/lib/whatsapp/v2/queueBatch', () => ({
  ingestConversationMessage: (...args: unknown[]) => mockIngest(...args),
}));
jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { v2_enabled: true }, error: null }),
    }),
  }),
}));

import { ingestCustomerInboundIfV2 } from '@/lib/whatsapp/v2/inboundIngest';

const input = {
  tenantId: 'tenant-1' as const,
  provider: 'evolution' as const,
  webhookExternalId: 'instance-1:provider-1',
  webhookPayload: { event: 'message' },
  fromNumber: '+2348031234567',
  toNumber: 'instance-1',
  content: 'book me tomorrow',
  messageType: 'text',
  providerMessageId: 'provider-1',
  providerTimestamp: '2026-09-29T08:00:00.000Z',
  raw: { provider: 'raw' },
  mediaInfo: null,
};

describe('ingestCustomerInboundIfV2', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveIncoming.mockResolvedValue({ role: 'customer', strippedMessage: 'book me tomorrow' });
    mockEnsureIdentity.mockResolvedValue({ identityId: 'identity-1', customerId: 'customer-1' });
    mockEnsureConversation.mockResolvedValue({ id: 'conversation-1' });
    mockEnsureThread.mockResolvedValue({ id: 'thread-1' });
    mockIngest.mockResolvedValue('queue-1');
  });

  it('resolves tenant-scoped identity and atomically ingests a customer message', async () => {
    await expect(ingestCustomerInboundIfV2(input)).resolves.toMatchObject({ queueId: 'queue-1' });
    expect(mockResolveIncoming).toHaveBeenCalledWith(
      'whatsapp', '+2348031234567', 'book me tomorrow', 'tenant-1',
    );
    expect(mockEnsureThread).toHaveBeenCalledWith({
      tenantId: 'tenant-1', customerId: 'customer-1', channelIdentityId: 'identity-1',
      channel: 'whatsapp', conversationId: 'conversation-1',
    });
    expect(mockIngest).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', conversationId: 'conversation-1', threadId: 'thread-1',
      webhookExternalId: 'instance-1:provider-1', providerMessageId: 'provider-1',
    }));
  });

  it('leaves owner and staff commands on the non-customer path', async () => {
    mockResolveIncoming.mockResolvedValue({ role: 'owner', strippedMessage: 'sales today' });
    await expect(ingestCustomerInboundIfV2(input)).resolves.toBeNull();
    expect(mockEnsureIdentity).not.toHaveBeenCalled();
    expect(mockIngest).not.toHaveBeenCalled();
  });
});
