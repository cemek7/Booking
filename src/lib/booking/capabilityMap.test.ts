import { describe, expect, it } from '@jest/globals';
import { BOOKA_PERMISSIONS } from '@/types/permissions';
import {
  getPermissionForAction,
  getPermissionForCapability,
  hasPermissionInSet,
  roleHasAnyCapability,
} from './capabilityMap';

describe('capabilityMap', () => {
  it('maps refund and staff-management capabilities to Booka permissions', () => {
    expect(getPermissionForCapability('refund')).toBe(BOOKA_PERMISSIONS.ISSUE_REFUNDS);
    expect(getPermissionForCapability('manage_staff')).toBe(BOOKA_PERMISSIONS.MANAGE_STAFF);
  });

  it('maps high-risk actions directly to the right permission', () => {
    expect(getPermissionForAction('refund_sale')).toBe(BOOKA_PERMISSIONS.ISSUE_REFUNDS);
    expect(getPermissionForAction('delete_product')).toBe(BOOKA_PERMISSIONS.MANAGE_PRODUCTS);
  });

  it('checks permission membership against an effective permission set', () => {
    const effective = new Set([BOOKA_PERMISSIONS.ADJUST_INVENTORY]);
    expect(hasPermissionInSet(effective, BOOKA_PERMISSIONS.ADJUST_INVENTORY)).toBe(true);
    expect(hasPermissionInSet(effective, BOOKA_PERMISSIONS.ISSUE_REFUNDS)).toBe(false);
  });

  it('derives capability access from effective role permissions', () => {
    expect(roleHasAnyCapability('owner', ['refund', 'manage_staff'])).toBe(true);
    expect(roleHasAnyCapability('staff', ['refund'])).toBe(false);
    expect(roleHasAnyCapability('staff', ['adjust_stock'])).toBe(false);
  });
});
