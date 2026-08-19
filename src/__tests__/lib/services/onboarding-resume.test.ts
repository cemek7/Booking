import { describe, it, expect, jest } from '@jest/globals';
import { findOwnedTenant, createOrResumeTenant } from '@/lib/services/onboarding-service';

// Minimal Supabase mock covering the two read chains findOwnedTenant uses:
//   tenant_users: select().eq().eq().order().limit().maybeSingle()
//   tenants:      select().eq().maybeSingle()
// Any .insert() throws, so a resume that wrongly creates a tenant fails loudly.
function makeSupabase({ ownerTenantId, tenantSlug }: { ownerTenantId: string | null; tenantSlug?: string }) {
  const insert = jest.fn(() => { throw new Error('insert must not be called when resuming'); });
  const client = {
    insert,
    from(table: string) {
      if (table === 'tenant_users') {
        return {
          insert,
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: ownerTenantId ? { tenant_id: ownerTenantId } : null,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'tenants') {
        return {
          insert,
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: ownerTenantId ? { id: ownerTenantId, slug: tenantSlug } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      return { insert };
    },
  };
  return client;
}

describe('onboarding idempotency guard', () => {
  it('findOwnedTenant returns the tenant a user already owns', async () => {
    const sb = makeSupabase({ ownerTenantId: 'tenant-1', tenantSlug: 'acme' });
    await expect(findOwnedTenant(sb as never, 'user-1')).resolves.toEqual({
      tenantId: 'tenant-1',
      slug: 'acme',
    });
  });

  it('findOwnedTenant returns null when the user owns no tenant', async () => {
    const sb = makeSupabase({ ownerTenantId: null });
    await expect(findOwnedTenant(sb as never, 'user-1')).resolves.toBeNull();
  });

  it('createOrResumeTenant RESUMES an existing tenant instead of creating a duplicate', async () => {
    const sb = makeSupabase({ ownerTenantId: 'tenant-1', tenantSlug: 'acme' });
    const res = await createOrResumeTenant(sb as never, 'user-1', { name: 'Acme' });
    expect(res).toEqual({ tenantId: 'tenant-1', slug: 'acme', resumed: true });
    // The insert-throwing mock proves no second tenant was created.
    expect(sb.insert).not.toHaveBeenCalled();
  });

  it('createOrResumeTenant with allowAdditional bypasses the guard (explicit multi-tenant)', async () => {
    // With allowAdditional it must NOT short-circuit on the existing tenant; it
    // proceeds to createTenant. We assert it does not return the resumed marker.
    const sb = makeSupabase({ ownerTenantId: 'tenant-1', tenantSlug: 'acme' });
    // createTenant will try to insert and our mock throws — that's expected here;
    // we only assert the guard was bypassed (it attempted creation).
    await expect(
      createOrResumeTenant(sb as never, 'user-1', { name: 'Second Biz' }, { allowAdditional: true })
    ).rejects.toThrow(/insert must not be called/);
  });
});
