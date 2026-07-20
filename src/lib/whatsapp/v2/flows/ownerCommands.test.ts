import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockExecuteAction = jest.fn();
const mockUpdateConversation = jest.fn();
const mockCaptureAnalytics = jest.fn();
const mockFindByIdempotencyKey = jest.fn();
const mockLogAiAction = jest.fn();
const mockRecordBusinessEvent = jest.fn();
const mockGetEffectivePermissions = jest.fn();

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: 'tenant-user-1', user_id: 'user-1', role: 'staff' },
        error: null,
      }),
    })),
  }),
}));

jest.mock('@/lib/booking/action-validator', () => ({
  executeAction: (...args: unknown[]) => mockExecuteAction(...args),
}));

jest.mock('../conversationState', () => ({
  updateConversation: (...args: unknown[]) => mockUpdateConversation(...args),
}));

jest.mock('@/lib/analytics/server', () => ({
  captureServerAnalyticsEvent: (...args: unknown[]) => mockCaptureAnalytics(...args),
}));

jest.mock('@/lib/ai/aiActionLog', () => ({
  findByIdempotencyKey: (...args: unknown[]) => mockFindByIdempotencyKey(...args),
  logAiAction: (...args: unknown[]) => mockLogAiAction(...args),
}));

jest.mock('@/lib/audit/businessEvents', () => ({
  BUSINESS_EVENT_ACTIONS: {
    COMMAND_DENIED: 'command.denied',
  },
  recordBusinessEvent: (...args: unknown[]) => mockRecordBusinessEvent(...args),
}));

jest.mock('@/lib/permissions/effectivePermissions', () => ({
  getEffectivePermissions: (...args: unknown[]) => mockGetEffectivePermissions(...args),
}));

import { handleOwnerCommand } from './ownerCommands';

describe('handleOwnerCommand', () => {
  beforeEach(() => {
    mockExecuteAction.mockReset();
    mockUpdateConversation.mockReset();
    mockCaptureAnalytics.mockReset();
    mockFindByIdempotencyKey.mockReset();
    mockLogAiAction.mockReset();
    mockRecordBusinessEvent.mockReset();
    mockGetEffectivePermissions.mockReset();
  });

  it('returns duplicate reply for repeated write commands', async () => {
    mockFindByIdempotencyKey.mockResolvedValue({ outcome: 'executed' });

    const reply = await handleOwnerCommand(
      '+2348000000000',
      'tenant-1',
      {
        action: 'add_product',
        params: { name: 'Gel', price: '₦18,000' },
        reply: 'Should not matter',
        confidence: 'high',
      },
      {
        role: 'owner',
        channel: 'whatsapp',
        external_id: '+2348000000000',
        flow_data: {},
      } as never,
      'Add Gel at ₦18,000'
    );

    expect(reply).toBe('I already handled that command.');
    expect(mockExecuteAction).not.toHaveBeenCalled();
  });

  it('denies staff refund commands and logs the denial', async () => {
    mockFindByIdempotencyKey.mockResolvedValue(null);
    mockGetEffectivePermissions.mockResolvedValue(new Set(['RECORD_PAYMENTS']));

    const reply = await handleOwnerCommand(
      '+2348000000000',
      'tenant-1',
      {
        action: 'refund_sale',
        params: { order_id: 'order-1', reason: 'customer changed mind' },
        reply: 'Confirm refund',
        confidence: 'high',
      },
      {
        role: 'staff',
        channel: 'whatsapp',
        external_id: '+2348000000000',
        flow_data: {},
      } as never,
      'Refund order 1'
    );

    expect(reply).toBe('You are not permitted to run that command.');
    expect(mockRecordBusinessEvent).toHaveBeenCalled();
    expect(mockLogAiAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'refund_sale',
        outcome: 'denied',
      })
    );
  });
});
