import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BUSINESS_EVENT_ACTIONS } from '@/lib/audit/businessEvents';

const mockRecordBusinessEvent = jest.fn();
const mockLogAiAction = jest.fn();

jest.mock('@/lib/audit/businessEvents', () => ({
  BUSINESS_EVENT_ACTIONS: {
    STAFF_PERMISSION_CHANGED: 'staff.permission_changed',
  },
  recordBusinessEvent: (...args: unknown[]) => mockRecordBusinessEvent(...args),
}));

jest.mock('@/lib/ai/aiActionLog', () => ({
  logAiAction: (...args: unknown[]) => mockLogAiAction(...args),
}));

import { staffHandlers } from './staff';

function makeAdmin() {
  return {
    from: jest.fn(() => {
      const state = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
      };
      return state;
    }),
  } as unknown as SupabaseClient;
}

describe('staffHandlers', () => {
  beforeEach(() => {
    mockRecordBusinessEvent.mockReset();
    mockLogAiAction.mockReset();
  });

  it('set_staff_capability logs an intent and emits staff.permission_changed', async () => {
    const admin = makeAdmin();

    const result = await staffHandlers.set_staff_capability.execute(
      admin,
      'tenant-1',
      { staff_id: 'staff-1', capability: 'refund', enabled: false },
      { actorId: 'user-1' }
    );

    expect(result.success).toBe(true);
    expect(mockLogAiAction).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        tenantId: 'tenant-1',
        action: 'set_staff_capability',
      })
    );
    expect(mockRecordBusinessEvent).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        action: BUSINESS_EVENT_ACTIONS.STAFF_PERMISSION_CHANGED,
        entityId: 'staff-1',
      })
    );
  });
});
