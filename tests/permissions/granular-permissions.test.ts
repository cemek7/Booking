import { describe, expect, it } from '@jest/globals';
import { BOOKA_PERMISSIONS, ROLE_PERMISSION_MAP } from '@/types/permissions';
import { getAllPermissionsForRole } from '@/types/enhanced-permissions';

describe('granular commerce permissions', () => {
  it('owner includes ISSUE_REFUNDS in the role defaults', () => {
    expect(ROLE_PERMISSION_MAP.owner).toContain(BOOKA_PERMISSIONS.ISSUE_REFUNDS);
  });

  it('staff excludes ISSUE_REFUNDS from the safe subset', () => {
    expect(ROLE_PERMISSION_MAP.staff).not.toContain(BOOKA_PERMISSIONS.ISSUE_REFUNDS);
  });

  it('manager inherits the staff-safe permissions while keeping the commerce approvals', () => {
    const permissions = getAllPermissionsForRole('manager');
    expect(permissions).toContain(BOOKA_PERMISSIONS.RECORD_SALES);
    expect(permissions).toContain(BOOKA_PERMISSIONS.APPROVE_REFUNDS);
    expect(permissions).not.toContain('billing:manage:all');
  });
});
