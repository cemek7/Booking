import { describe, expect, it } from '@jest/globals';
import { resolveLimit } from './policy';

describe('resolveLimit', () => {
  it('falls back to default discount tiers', () => {
    expect(resolveLimit('staff', 'discount', []).maxSelfApprove).toBe(5);
    expect(resolveLimit('manager', 'discount', []).maxSelfApprove).toBe(15);
    expect(resolveLimit('owner', 'discount', []).maxSelfApprove).toBe(Number.POSITIVE_INFINITY);
  });

  it('prefers tenant-specific policy rows when present', () => {
    const resolved = resolveLimit('staff', 'discount', [
      {
        request_type: 'discount',
        role: 'staff',
        max_self_approve: 7,
        requires_permission: 'APPROVE_LARGE_DISCOUNTS',
      },
    ]);

    expect(resolved).toEqual({
      maxSelfApprove: 7,
      requiresPermission: 'APPROVE_LARGE_DISCOUNTS',
      source: 'policy',
    });
  });
});
