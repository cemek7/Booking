import { describe, it, expect, jest } from '@jest/globals';

// getTenantPublicInfo builds its own admin client; mock it to return a tenant row.
const maybeSingle = jest.fn();
jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
  }),
}));

import { getTenantPublicInfo } from '@/lib/publicBookingService';

describe('getTenantPublicInfo', () => {
  it('returns the tenant (no 404) and derives description/logo from metadata', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: {
        id: 't-1',
        name: 'Mercury',
        slug: 'mercury-d107d1',
        industry: 'beauty',
        metadata: { description: 'Best salon', logo_url: 'https://x/logo.png' },
      },
      error: null,
    });

    const info = await getTenantPublicInfo('mercury-d107d1');
    expect(info).toMatchObject({
      id: 't-1',
      name: 'Mercury',
      slug: 'mercury-d107d1',
      industry: 'beauty',
      description: 'Best salon',
      logo: 'https://x/logo.png',
    });
  });

  it('does not throw when metadata is null (onboarded tenants have no branding yet)', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { id: 't-2', name: 'Mercury', slug: 'mercury-d107d1', industry: null, metadata: null },
      error: null,
    });

    const info = await getTenantPublicInfo('mercury-d107d1');
    expect(info.id).toBe('t-2');
    expect(info.description).toBeUndefined();
    expect(info.logo).toBeUndefined();
  });

  it('404s (throws) only when the tenant truly does not exist', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(getTenantPublicInfo('missing')).rejects.toBeDefined();
  });
});
