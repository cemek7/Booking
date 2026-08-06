import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

const mockLogAiAction = jest.fn();
const mockGetEffectivePermissions = jest.fn();
const mockSetPermissionOverride = jest.fn();

jest.mock('@/lib/ai/aiActionLog', () => ({
  logAiAction: (...args: unknown[]) => mockLogAiAction(...args),
}));

jest.mock('@/lib/permissions/effectivePermissions', () => ({
  getEffectivePermissions: (...args: unknown[]) => mockGetEffectivePermissions(...args),
}));

jest.mock('@/lib/permissions/overrides', () => ({
  setPermissionOverride: (...args: unknown[]) => mockSetPermissionOverride(...args),
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
    mockLogAiAction.mockReset();
    mockGetEffectivePermissions.mockReset();
    mockSetPermissionOverride.mockReset();
  });

  it('set_staff_capability writes a revoke override for payment permissions', async () => {
    const admin = makeAdmin();
    mockGetEffectivePermissions.mockResolvedValue(new Set(['MANAGE_STAFF', 'RECORD_PAYMENTS']));
    mockSetPermissionOverride.mockResolvedValue({ id: 'override-1' });

    const result = await staffHandlers.set_staff_capability.execute(
      admin,
      'tenant-1',
      { staff_id: 'staff-1', capability: 'payment', enabled: false },
      { actorId: 'actor-tenant-user-1', role: 'manager' }
    );

    expect(result.success).toBe(true);
    expect(mockSetPermissionOverride).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        tenantId: 'tenant-1',
        targetUserId: 'staff-1',
        permission: 'RECORD_PAYMENTS',
        effect: 'revoke',
      })
    );
    expect(mockLogAiAction).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        tenantId: 'tenant-1',
        action: 'set_staff_capability',
      })
    );
    expect(result.data).toEqual(expect.objectContaining({ permission: 'RECORD_PAYMENTS', enabled: false }));
  });
});
