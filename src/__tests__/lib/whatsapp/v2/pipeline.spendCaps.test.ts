import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockGetConversation = jest.fn();
const mockEnsureConversation = jest.fn();
const mockGetTenantWhatsAppConfig = jest.fn();
const mockIsTenantWhatsAppAgentEnabled = jest.fn();
const mockGetProviderClient = jest.fn();
const mockCheckCaps = jest.fn();
const mockMaybeAlertCap = jest.fn();
const mockIsQuotaExceeded = jest.fn();
const mockWithTenantWalletSpend = jest.fn();
const mockLoadCanonicalThread = jest.fn();

jest.mock('@/lib/whatsapp/v2/conversationState', () => ({
  getConversation: mockGetConversation,
  ensureConversation: mockEnsureConversation,
  updateConversation: jest.fn(async () => {}),
}));

jest.mock('@/lib/whatsapp/evolutionClient', () => ({
  getTenantWhatsAppConfig: mockGetTenantWhatsAppConfig,
  isTenantWhatsAppAgentEnabled: mockIsTenantWhatsAppAgentEnabled,
}));

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

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      insert: jest.fn().mockResolvedValue({ error: null }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    }),
  })),
}));

jest.mock('@/lib/ai/rulesEngine', () => ({
  normalizePidgin: jest.fn((m: string) => m),
  matchRule: jest.fn().mockReturnValue(null),
}));

jest.mock('@/lib/ai/quotaTracker', () => ({
  isQuotaExceeded: mockIsQuotaExceeded,
  recordAIUsage: jest.fn(),
}));

jest.mock('@/lib/billing/ai-wallet', () => ({
  estimatePromptTokens: jest.fn().mockReturnValue(100),
  withTenantWalletSpend: mockWithTenantWalletSpend,
}));

jest.mock('@/lib/billing/spendCaps/spendGuard', () => ({
  checkCaps: mockCheckCaps,
}));

jest.mock('@/lib/billing/spendCaps/spendAlerts', () => ({
  maybeAlertCap: mockMaybeAlertCap,
}));

jest.mock('@/lib/whatsapp/showcasePackService', () => ({
  looksLikeShowcaseRequest: jest.fn().mockReturnValue(false),
  sendShowcasePack: jest.fn(),
}));

jest.mock('@/lib/whatsapp/v2/flows/customerBooking', () => ({
  handleCustomerBooking: jest.fn().mockResolvedValue('customer reply'),
}));

jest.mock('@/lib/whatsapp/v2/flows/ownerCommands', () => ({
  handleOwnerCommand: jest.fn().mockResolvedValue('owner reply'),
}));

jest.mock('@/lib/whatsapp/v2/flows/ownerOnboarding', () => ({
  handleOnboarding: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/whatsapp/v2/aiDisclosure', () => ({
  sendDisclosureIfNeeded: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/whatsapp/v2/humanHandoff', () => ({
  wantsHuman: jest.fn().mockReturnValue(false),
  createHumanHandoff: jest.fn(),
}));

jest.mock('@/lib/whatsapp/v2/optInProof', () => ({
  buildOptInProofPatch: jest.fn().mockReturnValue(null),
}));
jest.mock('@/lib/whatsapp/v2/conversationThread', () => ({
  loadCanonicalThread: (...args: unknown[]) => mockLoadCanonicalThread(...args),
  updateThreadState: jest.fn(async () => ({ stateVersion: 1 })),
}));

jest.mock('@/lib/whatsapp/v2/outboundBranding', () => ({
  brandCustomerText: jest.fn(async (_tenantId: string, _externalId: string, reply: string) => reply),
}));

jest.mock('@/lib/booking/action-validator', () => ({
  validateAction: jest.fn().mockResolvedValue({ valid: true }),
}));

jest.mock('@/lib/ai/intent-router', () => ({
  routeIntent: jest.fn().mockResolvedValue({ intent: 'booking' }),
}));

jest.mock('@/lib/ai/grounding-service', () => ({
  getGroundingData: jest.fn().mockResolvedValue({}),
}));

jest.mock('@/lib/ai/context-builder', () => ({
  buildFrontDeskPrompt: jest.fn().mockReturnValue('prompt'),
}));

jest.mock('@/lib/ai/providers', () => ({
  getAIProvider: jest.fn(() => ({
    complete: jest.fn(),
  })),
}));

jest.mock('@/lib/ai/training-events', () => ({
  recordAITrainingEvent: jest.fn(),
}));

import { processConversationBatch } from '@/lib/whatsapp/v2/pipeline';
import type { ClaimedConversationBatch } from '@/lib/whatsapp/v2/queueBatch';

function makeConv() {
  return {
    id: 'conv-1',
    tenant_id: 'tenant-1',
    phone_number: '+2348000000000',
    role: 'customer' as const,
    current_flow: 'idle' as const,
    flow_step: 0,
    flow_data: {},
    customer_id: 'customer-1',
    active_thread_id: 'thread-1',
    state_version: 0,
    last_inbound_at: null,
    opted_out_at: null,
  };
}

function makeBatch(): ClaimedConversationBatch {
  return {
    batchId: 'batch-1', workerId: 'worker-1', tenantId: 'tenant-1', channel: 'whatsapp',
    externalId: '+2348000000000', conversationId: 'conv-1', threadId: 'thread-1',
    combinedText: 'book me', correlationKey: 'conversation-batch:test',
    rows: [{
      id: 'queue-1', tenantId: 'tenant-1', channel: 'whatsapp', externalId: '+2348000000000',
      conversationId: 'conv-1', threadId: 'thread-1', content: 'book me', messageId: 'msg-1',
      providerTimestamp: '2026-09-28T12:00:00.000Z', createdAt: '2026-09-28T12:00:00.100Z',
      batchId: 'batch-1', leaseOwner: 'worker-1', retryCount: 0, maxRetries: 3,
    }],
  };
}

describe('pipeline spend-cap gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConversation.mockResolvedValue(makeConv());
    mockEnsureConversation.mockResolvedValue(makeConv());
    mockGetTenantWhatsAppConfig.mockResolvedValue({ provider: 'evolution', instanceName: 'inst' });
    mockIsTenantWhatsAppAgentEnabled.mockResolvedValue(true);
    mockGetProviderClient.mockReturnValue({
      sendTextMessage: jest.fn().mockResolvedValue({ success: true, messageId: 'out-1' }),
    });
    mockIsQuotaExceeded.mockResolvedValue(false);
    mockWithTenantWalletSpend.mockResolvedValue({
      json: JSON.stringify({ action: 'answer', reply: 'ok', confidence: 'high' }),
      usage: {},
    });
    mockLoadCanonicalThread.mockResolvedValue({
      id: 'thread-1', tenantId: 'tenant-1', customerId: 'customer-1',
      channelIdentityId: 'identity-1', channel: 'whatsapp', status: 'active',
      structuredState: { confirmed: {}, proposed: {}, missing: [] }, stateVersion: 0,
      updatedAt: '2026-09-29T10:00:00.000Z',
    });
  });

  it('returns null before quota checks or wallet reserve when hard-capped', async () => {
    mockCheckCaps.mockResolvedValue({
      allowed: false,
      reason: 'daily_cap',
      softWarn: false,
      spentTodayCredits: 200,
      dailyBudgetCredits: 200,
    });

    const result = await processConversationBatch(makeBatch());

    expect(result).toEqual({ disposition: 'complete', correlationKey: 'conversation-batch:test' });
    expect(mockMaybeAlertCap).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'daily_cap');
    expect(mockIsQuotaExceeded).not.toHaveBeenCalled();
    expect(mockWithTenantWalletSpend).not.toHaveBeenCalled();
  });

  it('passes skipCapCheck to wallet spend after the pre-check allows the call', async () => {
    mockCheckCaps.mockResolvedValue({
      allowed: true,
      reason: 'ok',
      softWarn: false,
      spentTodayCredits: 10,
      dailyBudgetCredits: 200,
    });

    await processConversationBatch(makeBatch());

    expect(mockWithTenantWalletSpend).toHaveBeenCalled();
    const options = mockWithTenantWalletSpend.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(options.skipCapCheck).toBe(true);
  });
});
