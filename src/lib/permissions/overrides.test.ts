import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

const mockRecordBusinessEvent = jest.fn();

jest.mock('@/lib/audit/businessEvents', () => ({
  BUSINESS_EVENT_ACTIONS: {
    STAFF_PERMISSION_CHANGED: 'staff.permission_changed',
  },
  recordBusinessEvent: (...args: unknown[]) => mockRecordBusinessEvent(...args),
}));

import { resetPermissionOverride, setPermissionOverride } from './overrides';

function makeAdmin(rows: Record<string, unknown[] | unknown>) {
  const ops: Array<{ table: string; kind: string; payload?: unknown }> = [];

  const admin = {
    from(table: string) {
      const op = { table, kind: 'select', payload: undefined as unknown };
      ops.push(op);
      const b: Record<string, unknown> = {
        select() { op.kind ||= 'select'; return b; },
        eq() { return b; },
        upsert(payload: unknown) { op.kind = 'upsert'; op.payload = payload; return b; },
        delete() { op.kind = 'delete'; return b; },
        single() {
          const value = rows[`${table}:${op.kind}:single`] ?? rows[table];
          return Promise.resolve({ data: Array.isArray(value) ? value[0] ?? null : value ?? null, error: null });
        },
        maybeSingle() {
          const value = rows[`${table}:${op.kind}:maybeSingle`] ?? rows[table];
          return Promise.resolve({ data: Array.isArray(value) ? value.shift() ?? null : value ?? null, error: null });
        },
      };
      return b;
    },
  };

  return { admin: admin as unknown as SupabaseClient, ops };
}

describe('permission overrides', () => {
  beforeEach(() => {
    mockRecordBusinessEvent.mockReset();
  });

  it('blocks overrides when the actor lacks MANAGE_STAFF', async () => {
    const { admin } = makeAdmin({
      tenant_users: { id: 'target-1', role: 'staff' },
      tenant_user_permissions: null,
    });

    await expect(
      setPermissionOverride(admin, {
        tenantId: 'tenant-1',
        targetUserId: 'target-1',
        permission: BOOKA_PERMISSIONS.RECORD_PAYMENTS,
        effect: 'revoke',
        actorRole: 'manager',
        actorPerms: new Set([BOOKA_PERMISSIONS.VIEW_REVENUE]),
        actorUserId: 'actor-1',
      })
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('blocks revoking permissions from an owner', async () => {
    const { admin } = makeAdmin({
      tenant_users: { id: 'target-1', role: 'owner' },
      tenant_user_permissions: null,
    });

    await expect(
      setPermissionOverride(admin, {
        tenantId: 'tenant-1',
        targetUserId: 'target-1',
        permission: BOOKA_PERMISSIONS.RECORD_PAYMENTS,
        effect: 'revoke',
        actorRole: 'owner',
        actorPerms: new Set([BOOKA_PERMISSIONS.MANAGE_STAFF, BOOKA_PERMISSIONS.RECORD_PAYMENTS]),
        actorUserId: 'actor-1',
      })
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('blocks granting a permission the actor does not hold', async () => {
    const { admin } = makeAdmin({
      tenant_users: { id: 'target-1', role: 'staff' },
      tenant_user_permissions: null,
    });

    await expect(
      setPermissionOverride(admin, {
        tenantId: 'tenant-1',
        targetUserId: 'target-1',
        permission: BOOKA_PERMISSIONS.ISSUE_REFUNDS,
        effect: 'grant',
        actorRole: 'manager',
        actorPerms: new Set([BOOKA_PERMISSIONS.MANAGE_STAFF, BOOKA_PERMISSIONS.RECORD_PAYMENTS]),
        actorUserId: 'actor-1',
      })
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('allows granting within the actor permission set and emits an audit event', async () => {
    const { admin, ops } = makeAdmin({
      tenant_users: { id: 'target-1', role: 'staff', user_id: 'user-target' },
      tenant_user_permissions: null,
      'tenant_user_permissions:upsert:single': {
        id: 'override-1',
        tenant_user_id: 'target-1',
        permission: BOOKA_PERMISSIONS.RECORD_PAYMENTS,
        effect: 'grant',
      },
    });

    const row = await setPermissionOverride(admin, {
      tenantId: 'tenant-1',
      targetUserId: 'target-1',
      permission: BOOKA_PERMISSIONS.RECORD_PAYMENTS,
      effect: 'grant',
      actorRole: 'manager',
      actorPerms: new Set([BOOKA_PERMISSIONS.MANAGE_STAFF, BOOKA_PERMISSIONS.RECORD_PAYMENTS]),
      actorUserId: 'actor-1',
      reason: 'Trusted cashier',
    });

    expect(row).toEqual(expect.objectContaining({ id: 'override-1' }));
    expect(ops.find((entry) => entry.table === 'tenant_user_permissions' && entry.kind === 'upsert')?.payload).toEqual(
      expect.objectContaining({
        tenant_user_id: 'target-1',
        permission: BOOKA_PERMISSIONS.RECORD_PAYMENTS,
        effect: 'grant',
      })
    );
    expect(mockRecordBusinessEvent).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        action: 'staff.permission_changed',
        entityId: 'target-1',
      })
    );
  });

  it('resets an existing override back to role default', async () => {
    const { admin, ops } = makeAdmin({
      tenant_users: { id: 'target-1', role: 'staff', user_id: 'user-target' },
      tenant_user_permissions: { id: 'override-1', permission: BOOKA_PERMISSIONS.RECORD_PAYMENTS, effect: 'grant', reason: 'Trusted cashier' },
    });

    const row = await resetPermissionOverride(admin, {
      tenantId: 'tenant-1',
      targetUserId: 'target-1',
      permission: BOOKA_PERMISSIONS.RECORD_PAYMENTS,
      actorRole: 'manager',
      actorPerms: new Set([BOOKA_PERMISSIONS.MANAGE_STAFF]),
      actorUserId: 'actor-1',
      reason: 'Reset to default',
    });

    expect(row).toEqual(expect.objectContaining({ id: 'override-1' }));
    expect(ops.some((entry) => entry.table === 'tenant_user_permissions' && entry.kind === 'delete')).toBe(true);
  });
});
