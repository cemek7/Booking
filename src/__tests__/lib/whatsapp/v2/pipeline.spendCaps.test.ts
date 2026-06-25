import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockClaimBatch = jest.fn();
const mockGetConversation = jest.fn();
const mockEnsureConversation = jest.fn();
const mockGetTenantWhatsAppConfig = jest.fn();
const mockGetProviderClient = jest.fn();
const mockCheckCaps = jest.fn();
const mockMaybeAlertCap = jest.fn();
const mockIsQuotaExceeded = jest.fn();
const mockWithTenantWalletSpend = jest.fn();

jest.mock('@/lib/whatsapp/v2/messageBatcher', () => ({
  claimBatch: mockClaimBatch,
  appendPendingMessage: jest.fn(),
}));

jest.mock('@/lib/whatsapp/v2/conversationState', () => ({
  getConversation: mockGetConversation,
  ensureConversation: mockEnsureConversation,
  updateConversation: jest.fn(async () => {}),
}));

jest.mock('@/lib/whatsapp/evolutionClient', () => ({
  getTenantWhatsAppConfig: mockGetTenantWhatsAppConfig,
}));

jest.mock('@/lib/whatsapp/providers', () => ({
  getProviderClient: mockGetProviderClient,
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

import { processMessageV2 } from '@/lib/whatsapp/v2/pipeline';

function makeConv() {
  return {
    id: 'conv-1',
    tenant_id: 'tenant-1',
    phone_number: '+2348000000000',
    role: 'customer' as const,
    current_flow: 'idle' as const,
    flow_step: 0,
    flow_data: {},
    last_inbound_at: null,
    opted_out_at: null,
  };
}

describe('pipeline spend-cap gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClaimBatch.mockResolvedValue({ combined: 'book me', messageIds: ['msg-1'] });
    mockGetConversation.mockResolvedValue(makeConv());
    mockEnsureConversation.mockResolvedValue(makeConv());
    mockGetTenantWhatsAppConfig.mockResolvedValue({ provider: 'evolution', instanceName: 'inst' });
    mockGetProviderClient.mockReturnValue({
      sendTextMessage: jest.fn().mockResolvedValue({ success: true, messageId: 'out-1' }),
    });
    mockIsQuotaExceeded.mockResolvedValue(false);
    mockWithTenantWalletSpend.mockResolvedValue({
      json: JSON.stringify({ action: 'answer', reply: 'ok', confidence: 'high' }),
      usage: {},
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

    const result = await processMessageV2('+2348000000000', 'tenant-1', 'book me', 'msg-1');

    expect(result).toBe(true);
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

    await processMessageV2('+2348000000000', 'tenant-1', 'book me', 'msg-1');

    expect(mockWithTenantWalletSpend).toHaveBeenCalled();
    const options = mockWithTenantWalletSpend.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(options.skipCapCheck).toBe(true);
  });
});
