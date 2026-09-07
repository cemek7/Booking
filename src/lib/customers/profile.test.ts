import { describe, expect, it, jest } from '@jest/globals';

import { recomputeProfile } from './profile';

function makeAdmin() {
  const responseMap = new Map<string, { data: unknown; error: { message: string } | null }>();
  const ops: Array<{ table: string; kind: string; payload?: unknown }> = [];

  const admin = {
    __responses: responseMap,
    __ops: ops,
    from: jest.fn((table: string) => {
      const state = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        upsert: jest.fn((payload: unknown) => {
          ops.push({ table, kind: 'upsert', payload });
          return Promise.resolve({ error: null });
        }),
        then: undefined as unknown,
      } as {
        select: jest.Mock;
        eq: jest.Mock;
        upsert: jest.Mock;
        then?: (onfulfilled: (value: unknown) => unknown) => unknown;
      };

      state.then = (onfulfilled) =>
        Promise.resolve(onfulfilled(responseMap.get(table) ?? { data: [], error: null }));

      return state;
    }),
  };

  return admin as unknown as {
    __responses: Map<string, { data: unknown; error: { message: string } | null }>;
    __ops: Array<{ table: string; kind: string; payload?: unknown }>;
    from: jest.Mock;
  };
}

describe('recomputeProfile', () => {
  it('recomputes deterministic customer summary metrics', async () => {
    const admin = makeAdmin();
    admin.__responses.set('reservations', {
      data: [
        { id: 'r1', start_at: '2026-07-01T10:00:00.000Z', status: 'completed', price_cents_snapshot: 12000, tenant_staff_id: 'staff-1' },
        { id: 'r2', start_at: '2026-07-11T10:00:00.000Z', status: 'completed', price_cents_snapshot: 18000, tenant_staff_id: 'staff-1' },
        { id: 'r3', start_at: '2026-07-15T10:00:00.000Z', status: 'no_show', price_cents_snapshot: 0, tenant_staff_id: 'staff-2' },
        { id: 'r4', start_at: '2026-07-18T10:00:00.000Z', status: 'cancelled', price_cents_snapshot: 0, tenant_staff_id: 'staff-2' },
      ],
      error: null,
    });
    admin.__responses.set('retail_orders', {
      data: [
        { id: 'o1', status: 'fulfilled', payment_status: 'paid', total_cents: 9000, amount_paid_cents: 9000, updated_at: '2026-07-12T09:00:00.000Z' },
        { id: 'o2', status: 'pending_payment', payment_status: 'unpaid', total_cents: 4000, amount_paid_cents: 0, updated_at: '2026-07-13T09:00:00.000Z' },
      ],
      error: null,
    });
    admin.__responses.set('transactions', {
      data: [
        { amount: 120, type: 'payment', status: 'success', subject_type: 'reservation', subject_id: 'r1', reservation_id: 'r1' },
        { amount: 180, type: 'payment', status: 'success', subject_type: 'reservation', subject_id: 'r2', reservation_id: 'r2' },
        { amount: 90, type: 'payment', status: 'success', subject_type: 'retail_order', subject_id: 'o1', reservation_id: null },
        { amount: 50, type: 'payment', status: 'failed', subject_type: 'retail_order', subject_id: 'o2', reservation_id: null },
      ],
      error: null,
    });

    await recomputeProfile(admin as never, 'tenant-1', 'customer-1');

    const upsert = admin.__ops.find((entry) => entry.table === 'customer_profile_summary' && entry.kind === 'upsert');
    expect(upsert?.payload).toMatchObject({
      tenant_id: 'tenant-1',
      customer_id: 'customer-1',
      lifetime_bookings: 2,
      lifetime_value_cents: 39000,
      avg_spend_cents: 13000,
      outstanding_balance_cents: 4000,
      repeat_interval_days: 10,
      preferred_staff_id: 'staff-1',
      no_show_count: 1,
      cancellation_count: 1,
      last_visit: '2026-07-11T10:00:00.000Z',
    });
  });
});
