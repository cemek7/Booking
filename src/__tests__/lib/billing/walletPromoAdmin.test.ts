import { describe, it, expect, beforeEach } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Only a hash of a promo code is ever stored, which makes two things load
 * bearing: the plaintext must never reach the database, and it must be handed
 * back exactly once at creation because nothing can recover it afterwards.
 */

import {
  createPromoCode,
  generatePromoCode,
  listPromoCodes,
  setPromoCodeActive,
  PromoCodeConflictError,
} from '@/lib/billing/walletPromoAdmin';
import { hashPromoCode } from '@/lib/billing/walletPromo';

type Row = Record<string, unknown>;

const inserted: Array<{ table: string; row: Row }> = [];
const updated: Array<{ table: string; patch: Row; id: string }> = [];
let insertResult: { data: unknown; error: unknown } = { data: null, error: null };
let listResult: { data: unknown; error: unknown } = { data: [], error: null };
let countResult: { count: number; error: unknown } = { count: 0, error: null };
const selectedColumns: string[] = [];

function makeAdmin(): SupabaseClient {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        insert(row: Row) {
          inserted.push({ table, row });
          return {
            select: () => ({ single: async () => insertResult }),
          };
        },
        update(patch: Row) {
          return {
            eq: (_col: string, id: string) => {
              updated.push({ table, patch, id });
              return { select: () => ({ single: async () => insertResult }) };
            },
          };
        },
        select(cols: string, opts?: { count?: string; head?: boolean }) {
          selectedColumns.push(cols);
          if (opts?.head) {
            return { eq: async () => countResult };
          }
          return {
            order: () => ({ limit: async () => listResult }),
          };
        },
      };
      return builder as never;
    },
  } as unknown as SupabaseClient;
}

const admin = makeAdmin();

beforeEach(() => {
  inserted.length = 0;
  updated.length = 0;
  insertResult = { data: { id: 'p1', campaign: 'Launch', active: true }, error: null };
  listResult = { data: [], error: null };
  countResult = { count: 0, error: null };
  selectedColumns.length = 0;
});

describe('generatePromoCode', () => {
  it('avoids glyphs that get misread off a slide or a phone call', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generatePromoCode()).not.toMatch(/[O0I1L]/);
    }
  });

  it('produces a fixed-length code from the safe alphabet', () => {
    const code = generatePromoCode();
    expect(code).toHaveLength(10);
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
  });

  it('does not repeat itself across calls', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePromoCode()));
    expect(seen.size).toBe(50);
  });
});

describe('createPromoCode', () => {
  it('stores the hash and never the code itself', async () => {
    await createPromoCode({ admin, input: { campaign: 'Launch', amountCredits: 500, code: 'SUMMER26' } });

    const row = inserted[0].row;
    expect(row.code_hash).toBe(hashPromoCode('SUMMER26'));
    expect(JSON.stringify(row)).not.toContain('SUMMER26');
    expect(row).not.toHaveProperty('code');
  });

  it('returns the plaintext once, since nothing can recover it later', async () => {
    const { code } = await createPromoCode({
      admin, input: { campaign: 'Launch', amountCredits: 500, code: 'SUMMER26' },
    });
    expect(code).toBe('SUMMER26');
  });

  it('generates a code when none is supplied', async () => {
    const { code } = await createPromoCode({ admin, input: { campaign: 'Launch', amountCredits: 500 } });
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
    expect(inserted[0].row.code_hash).toBe(hashPromoCode(code));
  });

  it('normalizes a supplied code so it matches what redemption will hash', async () => {
    const { code } = await createPromoCode({
      admin, input: { campaign: 'Launch', amountCredits: 500, code: '  summer26 ' },
    });
    expect(code).toBe('SUMMER26');
    expect(inserted[0].row.code_hash).toBe(hashPromoCode('summer26'));
  });

  it('defaults the per-tenant cap to one rather than leaving it open', async () => {
    await createPromoCode({ admin, input: { campaign: 'Launch', amountCredits: 500 } });
    expect(inserted[0].row.max_redemptions_per_tenant).toBe(1);
    expect(inserted[0].row.max_redemptions).toBeNull();
  });

  it('turns a duplicate code into a usable error, not a 500', async () => {
    insertResult = { data: null, error: { code: '23505', message: 'duplicate key' } };
    await expect(createPromoCode({ admin, input: { campaign: 'Launch', amountCredits: 500, code: 'TAKEN' } }))
      .rejects.toBeInstanceOf(PromoCodeConflictError);
  });

  it('surfaces any other database failure', async () => {
    insertResult = { data: null, error: { code: '42501', message: 'permission denied' } };
    await expect(createPromoCode({ admin, input: { campaign: 'Launch', amountCredits: 500 } }))
      .rejects.toThrow('permission denied');
  });
});

describe('listPromoCodes', () => {
  it('reports how many times each code has been redeemed', async () => {
    listResult = { data: [{ id: 'p1', campaign: 'Launch' }], error: null };
    countResult = { count: 7, error: null };

    const rows = await listPromoCodes({ admin });
    expect(rows).toHaveLength(1);
    expect(rows[0].redemptions).toBe(7);
  });

  it('never selects the hash, so it cannot leak into a client payload', async () => {
    listResult = { data: [{ id: 'p1', campaign: 'Launch' }], error: null };
    await listPromoCodes({ admin });

    // Assert the column list actually sent, not the mock's canned reply — a
    // select('*') here would ship the hash straight to the browser.
    const codesSelect = selectedColumns[0];
    expect(codesSelect).not.toContain('code_hash');
    expect(codesSelect).not.toBe('*');
    expect(codesSelect).toContain('campaign');
  });

  it('refuses an unbounded page size', async () => {
    listResult = { data: [], error: null };
    await expect(listPromoCodes({ admin, limit: 10_000 })).resolves.toEqual([]);
  });
});

describe('setPromoCodeActive', () => {
  it('deactivates rather than deleting, so redemption history survives', async () => {
    await setPromoCodeActive({ admin, id: 'p1', active: false });
    expect(updated[0]).toMatchObject({ table: 'wallet_promo_codes', patch: { active: false }, id: 'p1' });
  });

  it('reactivates too', async () => {
    await setPromoCodeActive({ admin, id: 'p1', active: true });
    expect(updated[0].patch).toEqual({ active: true });
  });
});
