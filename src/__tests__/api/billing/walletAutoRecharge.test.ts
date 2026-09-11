import { beforeEach, describe, expect, it, jest } from '@jest/globals';

/**
 * The two things this route must never get wrong: it must not hand the card's
 * authorization code to the browser, and it must not let an owner arm
 * auto top-up that cannot fire.
 */

const definitions: Array<{ method: string; options: { auth?: boolean; roles?: string[] } }> = [];
jest.mock('@/lib/error-handling/route-handler', () => ({
  createHttpHandler: (
    handler: (ctx: unknown) => unknown,
    method: string,
    options: { auth?: boolean; roles?: string[] },
  ) => {
    definitions.push({ method, options });
    return handler;
  },
}));

type Row = Record<string, unknown>;
let walletRow: Row | null = null;
const updates: Row[] = [];

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        update: (patch: Row) => { updates.push(patch); return q; },
        eq: () => q,
        maybeSingle: async () => ({ data: walletRow, error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res),
      });
      return q;
    },
  }),
}));

import { GET, PATCH } from '@/app/api/billing/wallet/auto-recharge/route';

const SAVED_CARD: Row = {
  auto_recharge_enabled: false,
  auto_recharge_threshold_credits: 200,
  auto_recharge_amount_credits: 1000,
  paystack_authorization_code: 'AUTH_secret',
  paystack_card_brand: 'visa',
  paystack_card_last4: '4081',
};

function ctx(body: unknown = undefined) {
  return {
    request: { json: async () => body },
    user: { id: 'u1', role: 'owner', tenantId: 'tenant-1' },
    supabase: {},
  } as never;
}

beforeEach(() => {
  updates.length = 0;
  walletRow = { ...SAVED_CARD };
});

describe('auto-recharge settings route', () => {
  it('is owner-only on both methods', () => {
    expect(definitions.every((d) => d.options.roles?.includes('owner'))).toBe(true);
    expect(definitions.every((d) => d.options.auth)).toBe(true);
  });

  it('never returns the authorization code', async () => {
    const res = await GET(ctx()) as Record<string, unknown>;

    // It is a bearer credential for charging the tenant's card. The brand and
    // last four are all the browser needs.
    expect(JSON.stringify(res)).not.toContain('AUTH_secret');
    expect(res).toMatchObject({ has_saved_card: true, card_brand: 'visa', card_last4: '4081' });
  });

  it('reports no saved card when there is none', async () => {
    walletRow = { auto_recharge_enabled: false };
    const res = await GET(ctx()) as Record<string, unknown>;
    expect(res.has_saved_card).toBe(false);
  });

  it('handles a tenant with no wallet row at all', async () => {
    walletRow = null;
    const res = await GET(ctx()) as Record<string, unknown>;
    expect(res).toMatchObject({ enabled: false, has_saved_card: false, amount_credits: null });
  });

  it('refuses to enable auto top-up with no saved card', async () => {
    walletRow = { auto_recharge_enabled: false, auto_recharge_amount_credits: 1000 };

    // Arming something that cannot fire would leave the owner believing they
    // are covered, and finding out when their bot goes quiet.
    await expect(PATCH(ctx({ enabled: true }))).rejects.toBeTruthy();
    expect(updates).toHaveLength(0);
  });

  it('refuses to enable with no amount configured', async () => {
    walletRow = { ...SAVED_CARD, auto_recharge_amount_credits: null };

    await expect(PATCH(ctx({ enabled: true }))).rejects.toBeTruthy();
    expect(updates).toHaveLength(0);
  });

  it('enables when a card and an amount are both present', async () => {
    await PATCH(ctx({ enabled: true, threshold_credits: 250, amount_credits: 2000 }));

    expect(updates[0]).toMatchObject({
      auto_recharge_enabled: true,
      auto_recharge_threshold_credits: 250,
      auto_recharge_amount_credits: 2000,
    });
  });

  it('always allows turning it off, card or not', async () => {
    walletRow = { auto_recharge_enabled: true };

    await PATCH(ctx({ enabled: false }));

    expect(updates[0]).toMatchObject({ auto_recharge_enabled: false });
  });

  it('keeps the stored values when the patch omits them', async () => {
    await PATCH(ctx({ enabled: true }));

    expect(updates[0]).toMatchObject({
      auto_recharge_threshold_credits: 200,
      auto_recharge_amount_credits: 1000,
    });
  });
});
