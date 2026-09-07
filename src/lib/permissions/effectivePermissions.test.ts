import { describe, expect, it } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BOOKA_PERMISSIONS } from '@/types/permissions';
import { getEffectivePermissions } from './effectivePermissions';

function makeAdmin(rows: Record<string, unknown[] | unknown>) {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {
        select() { return b; },
        eq() { return b; },
        maybeSingle() {
          const value = rows[table];
          return Promise.resolve({ data: Array.isArray(value) ? value[0] ?? null : value ?? null, error: null });
        },
        then(resolve: (value: { data: unknown; error: null }) => unknown) {
          return Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve);
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

describe('getEffectivePermissions', () => {
  it('composes role defaults with revoke and grant overrides', async () => {
    const admin = makeAdmin({
      tenant_users: { id: 'tu-1', role: 'manager' },
      tenant_user_permissions: [
        { permission: BOOKA_PERMISSIONS.RECORD_PAYMENTS, effect: 'revoke' },
        { permission: 'CUSTOM_EXPORT_REPORTS', effect: 'grant' },
      ],
    });

    const permissions = await getEffectivePermissions(admin, 'tenant-1', 'tu-1');

    expect(permissions.has(BOOKA_PERMISSIONS.RECORD_PAYMENTS)).toBe(false);
    expect(permissions.has('CUSTOM_EXPORT_REPORTS')).toBe(true);
    expect(permissions.has(BOOKA_PERMISSIONS.MANAGE_STAFF)).toBe(true);
  });
});
