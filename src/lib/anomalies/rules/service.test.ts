import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceRules } from './service';

function makeAdmin() {
  const responseMap = new Map<string, { data: unknown; error: { message: string } | null }>();

  return {
    __responses: responseMap,
    from: jest.fn((table: string) => {
      const state = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gt: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lt: jest.fn().mockReturnThis(),
        then: undefined as unknown,
      } as {
        select: jest.Mock;
        eq: jest.Mock;
        gt: jest.Mock;
        gte: jest.Mock;
        lt: jest.Mock;
        then?: (onfulfilled: (value: unknown) => unknown, onrejected?: (reason: unknown) => unknown) => unknown;
      };

      state.then = (onfulfilled) =>
        Promise.resolve(onfulfilled(responseMap.get(table) ?? { data: null, error: null }));

      return state;
    }),
  } as unknown as SupabaseClient & { __responses: Map<string, { data: unknown; error: { message: string } | null }> };
}

describe('serviceRules', () => {
  it('flags completed_service_unpaid when a completed reservation has no successful payment', async () => {
    const admin = makeAdmin();
    admin.__responses.set('reservations', {
      data: [{ id: 'reservation-1', price_cents_snapshot: 12000 }],
      error: null,
    });
    admin.__responses.set('transactions', {
      data: [],
      error: null,
    });

    const candidates = await serviceRules[0].detect(admin, 'tenant-1', {
      startUtc: '2026-07-20T00:00:00.000Z',
      endUtc: '2026-07-21T00:00:00.000Z',
    }, { window: { startUtc: '2026-07-20T00:00:00.000Z', endUtc: '2026-07-21T00:00:00.000Z' } });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(expect.objectContaining({
      ruleKey: 'completed_service_unpaid',
      entityId: 'reservation-1',
      differenceCents: 12000,
    }));
  });

  it('does not flag a completed reservation when payment covers the snapshot price', async () => {
    const admin = makeAdmin();
    admin.__responses.set('reservations', {
      data: [{ id: 'reservation-1', price_cents_snapshot: 12000 }],
      error: null,
    });
    admin.__responses.set('transactions', {
      data: [{ subject_type: 'reservation', subject_id: 'reservation-1', amount: 120, type: 'payment', status: 'success' }],
      error: null,
    });

    const candidates = await serviceRules[0].detect(admin, 'tenant-1', {
      startUtc: '2026-07-20T00:00:00.000Z',
      endUtc: '2026-07-21T00:00:00.000Z',
    }, { window: { startUtc: '2026-07-20T00:00:00.000Z', endUtc: '2026-07-21T00:00:00.000Z' } });

    expect(candidates).toHaveLength(0);
  });

  it('flags deposits_not_applied when only successful deposits exist for a completed reservation', async () => {
    const admin = makeAdmin();
    admin.__responses.set('reservations', {
      data: [{ id: 'reservation-2', price_cents_snapshot: 20000 }],
      error: null,
    });
    admin.__responses.set('transactions', {
      data: [{ subject_type: 'reservation', subject_id: 'reservation-2', amount: 50, type: 'deposit', status: 'success' }],
      error: null,
    });

    const depositsRule = serviceRules.find((rule) => rule.key === 'deposits_not_applied');
    expect(depositsRule).toBeDefined();

    const candidates = await depositsRule!.detect(admin, 'tenant-1', {
      startUtc: '2026-07-20T00:00:00.000Z',
      endUtc: '2026-07-21T00:00:00.000Z',
    }, { window: { startUtc: '2026-07-20T00:00:00.000Z', endUtc: '2026-07-21T00:00:00.000Z' } });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(expect.objectContaining({
      ruleKey: 'deposits_not_applied',
      entityId: 'reservation-2',
      actualValueCents: 5000,
    }));
  });
});
