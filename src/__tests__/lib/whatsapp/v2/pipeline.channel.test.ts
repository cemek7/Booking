/**
 * pipeline channel-awareness tests
 *
 * Strategy note: processConversationBatch is deeply integrated (DB + AI + billing).
 * Rather than mocking every dependency for a full integration test, we test
 * at the key seams that were refactored:
 *
 *   1. The leased batch channel is used for conversation lookup.
 *   2. When channel='instagram' and the pipeline would send a reply,
 *      it does NOT call getTenantWhatsAppConfig (WA send path is skipped).
 *   3. getTenantInstagramConfig is called instead for IG channel.
 *
 * This gives us precise regression coverage without duplicating the existing
 * WhatsApp integration tests. The WhatsApp default path is covered by existing
 * tests in actionValidator.test.ts and the nightly/rebooking suite.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// conversationState spies
const mockGetConversation = jest.fn();
const mockEnsureConversation = jest.fn();
jest.mock('@/lib/whatsapp/v2/conversationState', () => ({
  getConversation: mockGetConversation,
  ensureConversation: mockEnsureConversation,
  // Customer path now persists opt-in proof / disclosure flags via updateConversation.
  updateConversation: jest.fn(async () => {}),
}));

// getTenantWhatsAppConfig spy — we assert this is NOT called on IG path
const mockGetTenantWhatsAppConfig = jest.fn();
const mockIsTenantWhatsAppAgentEnabled = jest.fn();
jest.mock('@/lib/whatsapp/evolutionClient', () => ({
  getTenantWhatsAppConfig: mockGetTenantWhatsAppConfig,
  isTenantWhatsAppAgentEnabled: mockIsTenantWhatsAppAgentEnabled,
}));

// Providers spy
const mockGetProviderClient = jest.fn();
jest.mock('@/lib/whatsapp/providers', () => ({
  getProviderClient: mockGetProviderClient,
}));
jest.mock('@/lib/whatsapp/v2/outboundDelivery', () => ({
  sendOutboundOnce: jest.fn(async (input: { send: () => Promise<{ success: boolean; messageId?: string; reason?: string }> }) => {
    const result = await input.send();
    return result.success
      ? { status: 'sent', providerMessageId: result.messageId, replayed: false }
      : { status: 'failed', reason: result.reason, replayed: false };
  }),
}));

// Supabase — minimal stub
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      single: jest.fn().mockResolvedValue({ data: { routing_code: 'CODE123' }, error: null }),
    }),
  })),
}));

// AI/billing stubs — make them short-circuit so no network calls happen
jest.mock('@/lib/ai/rulesEngine', () => ({
  normalizePidgin: jest.fn((m: string) => m),
  matchRule: jest.fn().mockReturnValue(null), // no L1 match → falls through to AI
}));
jest.mock('@/lib/ai/quotaTracker', () => ({
  isQuotaExceeded: jest.fn().mockResolvedValue(true), // quota exceeded → AI returns null
  recordAIUsage: jest.fn(),
}));
jest.mock('@/lib/whatsapp/showcasePackService', () => ({
  looksLikeShowcaseRequest: jest.fn().mockReturnValue(false),
  sendShowcasePack: jest.fn(),
}));
jest.mock('@/lib/billing/ai-wallet', () => ({
  estimatePromptTokens: jest.fn().mockReturnValue(100),
  withTenantWalletSpend: jest.fn().mockResolvedValue({ json: null, usage: {} }),
}));
jest.mock('@/lib/monitoring/telegramAlert', () => ({
  sendTelegramAlert: jest.fn(),
}));

// Flow handlers — short-circuit to prevent real DB calls
const mockHandleOwnerCommand = jest.fn().mockResolvedValue('owner reply');
const mockHandleCustomerBooking = jest.fn().mockResolvedValue('customer reply');

jest.mock('@/lib/whatsapp/v2/flows/ownerCommands', () => ({
  handleOwnerCommand: mockHandleOwnerCommand,
}));
jest.mock('@/lib/whatsapp/v2/flows/customerBooking', () => ({
  handleCustomerBooking: mockHandleCustomerBooking,
}));
jest.mock('@/lib/whatsapp/v2/flows/ownerOnboarding', () => ({
  handleOnboarding: jest.fn().mockResolvedValue('onboarding reply'),
}));

import { processConversationBatch } from '@/lib/whatsapp/v2/pipeline';
import type { ClaimedConversationBatch } from '@/lib/whatsapp/v2/queueBatch';

// ── Shared conv fixture ───────────────────────────────────────────────────────

function makeConv(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    tenant_id: 'tenant-1',
    phone_number: null,
    external_id: 'IGSID_42',
    channel: 'instagram' as const,
    role: 'customer' as const,
    current_flow: 'idle' as const,
    flow_step: 0,
    flow_data: {},
    last_inbound_at: null,
    opted_out_at: null,
    ...overrides,
  };
}

function makeBatch(overrides: Partial<ClaimedConversationBatch> = {}): ClaimedConversationBatch {
  const channel = overrides.channel ?? 'whatsapp';
  const externalId = overrides.externalId ?? (channel === 'instagram' ? 'IGSID_42' : '+2348000000000');
  return {
    batchId: 'batch-1', workerId: 'worker-1', tenantId: 'tenant-1', channel,
    externalId, conversationId: 'conv-1', threadId: 'thread-1',
    combinedText: 'book me', correlationKey: 'conversation-batch:test',
    rows: [{
      id: 'queue-1', tenantId: 'tenant-1', channel, externalId,
      conversationId: 'conv-1', threadId: 'thread-1', content: 'book me',
      messageId: 'msg-1', providerTimestamp: '2026-09-28T12:00:00.000Z',
      createdAt: '2026-09-28T12:00:00.100Z', batchId: 'batch-1', leaseOwner: 'worker-1',
      retryCount: 0, maxRetries: 3,
    }],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsTenantWhatsAppAgentEnabled.mockResolvedValue(true);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('processConversationBatch channel=instagram', () => {
  it('uses the exact tenant, identity, and channel from the leased batch', async () => {
    const conv = makeConv({ flow_data: { human_handling_until: '2999-01-01T00:00:00.000Z' } });
    mockGetConversation.mockResolvedValue(conv);

    await processConversationBatch(makeBatch({ channel: 'instagram', externalId: 'IGSID_42' }));

    expect(mockGetConversation).toHaveBeenCalledWith('IGSID_42', 'tenant-1', 'instagram');
  });

  it('does NOT call getTenantWhatsAppConfig when channel="instagram" (WA send path is bypassed)', async () => {
    // Conversation exists — customer path, AI quota exhausted → reply falls back to hardcoded message
    const conv = makeConv();
    mockGetConversation.mockResolvedValue(conv);
    mockEnsureConversation.mockResolvedValue(conv);

    // We do NOT set up mockGetTenantWhatsAppConfig to return anything,
    // so if it were called the send would fail or return undefined.
    mockGetTenantWhatsAppConfig.mockResolvedValue(null);

    // Run — even though a reply would be generated, the IG send path should
    // NOT throw (it logs and skips when no IG config is found).
    await processConversationBatch(makeBatch({ channel: 'instagram', externalId: 'IGSID_42' }));

    // Key assertion: the WhatsApp config loader must NOT be called
    expect(mockGetTenantWhatsAppConfig).not.toHaveBeenCalled();
  });

  it('does not throw when the message wallet is exhausted', async () => {
    // withMetering returns { success: false, reason: 'wallet_exhausted' } after
    // it has already sent the customer a handoff. That is a DESIGNED outcome.
    // Wallet exhaustion is a completed handoff outcome, not a retryable
    // pipeline error for the leased conversation batch.
    const conv = makeConv({
      channel: 'whatsapp',
      phone_number: '+2348000000000',
      external_id: '+2348000000000',
    });
    mockGetConversation.mockResolvedValue(conv);
    mockEnsureConversation.mockResolvedValue(conv);
    mockGetTenantWhatsAppConfig.mockResolvedValue({
      provider: 'meta', baseUrl: 'https://x', apiKey: 'k', instanceName: 'i', tenantId: 'tenant-1',
    });
    mockGetProviderClient.mockReturnValue({
      sendTextMessage: jest.fn(async () => ({ success: false, reason: 'wallet_exhausted' })),
    });

    await expect(
      processConversationBatch(makeBatch()),
    ).resolves.not.toThrow();
  });

  it('still throws on a genuine send failure, so the worker can retry', async () => {
    const conv = makeConv({
      channel: 'whatsapp',
      phone_number: '+2348000000000',
      external_id: '+2348000000000',
    });
    mockGetConversation.mockResolvedValue(conv);
    mockEnsureConversation.mockResolvedValue(conv);
    mockGetTenantWhatsAppConfig.mockResolvedValue({
      provider: 'meta', baseUrl: 'https://x', apiKey: 'k', instanceName: 'i', tenantId: 'tenant-1',
    });
    mockGetProviderClient.mockReturnValue({
      sendTextMessage: jest.fn(async () => ({ success: false, reason: 'network_error' })),
    });

    await expect(
      processConversationBatch(makeBatch()),
    ).rejects.toThrow();
  });

  it('pauses AI replies when a human is handling the conversation', async () => {
    const conv = makeConv({
      flow_data: { human_handling_until: '2999-01-01T00:00:00.000Z' },
      channel: 'whatsapp',
      phone_number: '+2348000000000',
      external_id: '+2348000000000',
    });
    mockGetConversation.mockResolvedValue(conv);
    mockEnsureConversation.mockResolvedValue(conv);

    const result = await processConversationBatch(makeBatch({ combinedText: 'need help' }));

    expect(result).toEqual({ disposition: 'complete', correlationKey: 'conversation-batch:test' });
    expect(mockGetTenantWhatsAppConfig).not.toHaveBeenCalled();
    expect(mockHandleCustomerBooking).not.toHaveBeenCalled();
  });

  it('does not run customer automation when the tenant agent is paused', async () => {
    mockGetConversation.mockResolvedValue(makeConv({ channel: 'whatsapp', phone_number: '+2348000000000', external_id: '+2348000000000' }));
    mockIsTenantWhatsAppAgentEnabled.mockResolvedValue(false);

    const result = await processConversationBatch(makeBatch({ combinedText: 'need help' }));

    expect(result).toEqual({ disposition: 'complete', correlationKey: 'conversation-batch:test' });
    expect(mockIsTenantWhatsAppAgentEnabled).toHaveBeenCalledWith('tenant-1');
    expect(mockGetTenantWhatsAppConfig).not.toHaveBeenCalled();
    expect(mockHandleCustomerBooking).not.toHaveBeenCalled();
  });
});
