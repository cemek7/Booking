import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ── Supabase mock ──────────────────────────────────────────────────────────
type DbResponse = { data: unknown; error?: unknown };
const responses: DbResponse[] = [];
type TenantBrandUpdate = { display_name?: string; renamed_at?: string; previous_names?: Array<{ name: string; renamed_at: string }> };
type MockChain = {
  select: () => MockChain;
  eq: () => MockChain;
  maybeSingle: () => Promise<DbResponse>;
  update: (payload: TenantBrandUpdate) => MockChain;
  then: PromiseLike<DbResponse>['then'];
};
const updateCalls: TenantBrandUpdate[] = [];

function makeChain() {
  const chain = {} as MockChain;
  chain.select = jest.fn().mockReturnValue(chain);
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.maybeSingle = jest.fn().mockImplementation(() => Promise.resolve(responses.shift() ?? { data: null, error: null }));
  chain.update = jest.fn().mockImplementation((payload: Record<string, unknown>) => {
    updateCalls.push(payload);
    return chain;
  });
  // update(...).eq(...) is awaited directly
  chain.then = (onF: (v: DbResponse) => unknown, onR?: (e: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(onF, onR);
  return chain;
}
const mockClient = { from: jest.fn().mockImplementation(() => makeChain()) };
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => mockClient) }));
// The v2 modules reach the database via createSupabaseAdminClient() in
// @/lib/supabase/server, not createClient from @supabase/supabase-js.
jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(() => mockClient),
}));

import { suggestEmojiForVertical, renameTenantBrand } from '@/lib/whatsapp/v2/tenantBrand';

describe('suggestEmojiForVertical', () => {
  it.each([
    ['barber', '✂️'],
    ['barbershop', '✂️'],
    ['Salon', '💇'],
    ['spa', '💆'],
    ['DENTAL', '🦷'],
  ])('maps %s → %s (case-insensitive)', (vertical, emoji) => {
    expect(suggestEmojiForVertical(vertical)).toBe(emoji);
  });

  it('returns null for unknown / missing vertical', () => {
    expect(suggestEmojiForVertical('gym')).toBeNull();
    expect(suggestEmojiForVertical(null)).toBeNull();
    expect(suggestEmojiForVertical(undefined)).toBeNull();
  });
});

describe('renameTenantBrand', () => {
  beforeEach(() => {
    responses.length = 0;
    updateCalls.length = 0;
    jest.clearAllMocks();
  });

  it('archives the current display_name and sets the new name + renamed_at', async () => {
    responses.push({ data: { name: 'Acme', display_name: 'Acme Cuts', previous_names: [] }, error: null });

    await renameTenantBrand('tenant_1', 'Acme Studio');

    expect(updateCalls).toHaveLength(1);
    const payload = updateCalls[0];
    expect(payload.display_name).toBe('Acme Studio');
    expect(payload.renamed_at).toEqual(expect.any(String));
    expect(payload.previous_names).toEqual([
      { name: 'Acme Cuts', renamed_at: expect.any(String) },
    ]);
  });

  it('falls back to account name when display_name is null, and appends to existing history', async () => {
    responses.push({
      data: { name: 'Acme', display_name: null, previous_names: [{ name: 'Old', renamed_at: '2026-01-01T00:00:00Z' }] },
      error: null,
    });

    await renameTenantBrand('tenant_1', 'Acme Studio');

    const payload = updateCalls[0];
    expect(payload.previous_names).toEqual([
      { name: 'Old', renamed_at: '2026-01-01T00:00:00Z' },
      { name: 'Acme', renamed_at: expect.any(String) },
    ]);
  });

  it('throws when the tenant does not exist', async () => {
    responses.push({ data: null, error: null });
    await expect(renameTenantBrand('ghost', 'X')).rejects.toThrow(/ghost/);
    expect(updateCalls).toHaveLength(0);
  });
});
