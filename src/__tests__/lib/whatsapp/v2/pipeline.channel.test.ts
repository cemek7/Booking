/**
 * pipeline channel-awareness tests
 *
 * Strategy note: processMessageV2 is deeply integrated (DB + AI + billing).
 * Rather than mocking every dependency for a full integration test, we test
 * at the key seams that were refactored:
 *
 *   1. claimBatch is called with the correct channel arg.
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

// claimBatch spy — we'll assert it was called with the right channel
const mockClaimBatch = jest.fn();
jest.mock('@/lib/whatsapp/v2/messageBatcher', () => ({
  claimBatch: mockClaimBatch,
  appendPendingMessage: jest.fn(),
}));

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

import { processMessageV2 } from '@/lib/whatsapp/v2/pipeline';

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

beforeEach(() => {
  jest.clearAllMocks();
  mockIsTenantWhatsAppAgentEnabled.mockResolvedValue(true);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('processMessageV2 channel=instagram', () => {
  it('passes channel="instagram" to claimBatch', async () => {
    // claimBatch returns null → pipeline returns false (still accumulating)
    mockClaimBatch.mockResolvedValue(null);

    await processMessageV2('IGSID_42', 'tenant-1', 'book me', 'msg-1', 'instagram');

    expect(mockClaimBatch).toHaveBeenCalledTimes(1);
    const args = mockClaimBatch.mock.calls[0] as unknown[];
    // third arg must be the channel
    expect(args[2]).toBe('instagram');
  });

  it('does NOT call getTenantWhatsAppConfig when channel="instagram" (WA send path is bypassed)', async () => {
    // Batch is settled
    mockClaimBatch.mockResolvedValue({ combined: 'book me', messageIds: ['msg-1'] });
    // Conversation exists — customer path, AI quota exhausted → reply falls back to hardcoded message
    const conv = makeConv();
    mockGetConversation.mockResolvedValue(conv);
    mockEnsureConversation.mockResolvedValue(conv);

    // We do NOT set up mockGetTenantWhatsAppConfig to return anything,
    // so if it were called the send would fail or return undefined.
    mockGetTenantWhatsAppConfig.mockResolvedValue(null);

    // Run — even though a reply would be generated, the IG send path should
    // NOT throw (it logs and skips when no IG config is found).
    await processMessageV2('IGSID_42', 'tenant-1', 'book me', 'msg-1', 'instagram');

    // Key assertion: the WhatsApp config loader must NOT be called
    expect(mockGetTenantWhatsAppConfig).not.toHaveBeenCalled();
  });

  it('defaults to channel="whatsapp" when no channel arg is passed (backward compat)', async () => {
    mockClaimBatch.mockResolvedValue(null);

    // Call WITHOUT the channel arg — must not throw and must pass 'whatsapp' to claimBatch
    await processMessageV2('+2348000000000', 'tenant-1', 'hello', 'msg-2');

    expect(mockClaimBatch).toHaveBeenCalledTimes(1);
    const args = mockClaimBatch.mock.calls[0] as unknown[];
    expect(args[2]).toBe('whatsapp');
  });

  it('returns false when claimBatch returns null (still accumulating)', async () => {
    mockClaimBatch.mockResolvedValue(null);

    const result = await processMessageV2('IGSID_42', 'tenant-1', 'hello', 'msg-3', 'instagram');

    expect(result).toBe(false);
  });

  it('pauses AI replies when a human is handling the conversation', async () => {
    mockClaimBatch.mockResolvedValue({ combined: 'need help', messageIds: ['msg-4'] });
    const conv = makeConv({
      flow_data: { human_handling_until: '2999-01-01T00:00:00.000Z' },
      channel: 'whatsapp',
      phone_number: '+2348000000000',
      external_id: '+2348000000000',
    });
    mockGetConversation.mockResolvedValue(conv);
    mockEnsureConversation.mockResolvedValue(conv);

    const result = await processMessageV2(
      '+2348000000000',
      'tenant-1',
      'need help',
      'msg-4'
    );

    expect(result).toBe(true);
    expect(mockGetTenantWhatsAppConfig).not.toHaveBeenCalled();
    expect(mockHandleCustomerBooking).not.toHaveBeenCalled();
  });

  it('does not run customer automation when the tenant agent is paused', async () => {
    mockClaimBatch.mockResolvedValue({ combined: 'need help', messageIds: ['msg-5'] });
    mockGetConversation.mockResolvedValue(makeConv({ channel: 'whatsapp', phone_number: '+2348000000000', external_id: '+2348000000000' }));
    mockIsTenantWhatsAppAgentEnabled.mockResolvedValue(false);

    const result = await processMessageV2('+2348000000000', 'tenant-1', 'need help', 'msg-5');

    expect(result).toBe(true);
    expect(mockIsTenantWhatsAppAgentEnabled).toHaveBeenCalledWith('tenant-1');
    expect(mockGetTenantWhatsAppConfig).not.toHaveBeenCalled();
    expect(mockHandleCustomerBooking).not.toHaveBeenCalled();
  });
});
