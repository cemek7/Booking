import { describe, it, expect } from '@jest/globals';
import { exportCustomerData } from '@/lib/dsar/export';

interface Call {
  table: string;
  filters: Array<[string, ...unknown[]]>;
}

function makeAdmin(fixtures: Record<string, unknown[]>) {
  const calls: Call[] = [];
  const admin = {
    from(table: string) {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq(col: string, val: unknown) { call.filters.push(['eq', col, val]); return builder; },
        or(expr: string) { call.filters.push(['or', expr]); return builder; },
        in(col: string, vals: unknown[]) { call.filters.push(['in', col, vals]); return builder; },
        single() { return Promise.resolve({ data: fixtures[table]?.[0] ?? null, error: null }); },
        then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve({ data: fixtures[table] ?? [], error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { admin: admin as never, calls };
}

describe('exportCustomerData', () => {
  it('returns the customer plus rows from every registry table', async () => {
    const { admin, calls } = makeAdmin({
      customers: [{ id: 'c1', tenant_id: 't1', phone: '2348000000000', name: 'Ada' }],
      reservations: [{ id: 'r1' }],
      transactions: [{ id: 'x1', reservation_id: 'r1', name: 'Ada' }],
      messages: [{ id: 'm1', from_number: '2348000000000' }],
      reviews: [{ id: 'v1', customer_id: 'c1' }],
    });

    const result = await exportCustomerData(admin, { tenantId: 't1', customerId: 'c1' });

    expect((result.customer as { name: string }).name).toBe('Ada');
    expect(result.tables.transactions).toHaveLength(1);
    expect(result.tables.messages).toHaveLength(1);
    expect(result.tables.reviews).toHaveLength(1);

    // phone-linked table uses an OR across its phone columns
    const messagesCall = calls.find((c) => c.table === 'messages');
    expect(messagesCall?.filters).toContainEqual(['or', 'from_number.eq.2348000000000,to_number.eq.2348000000000']);

    // reservationId-linked table queries by the customer's reservation ids
    const txCall = calls.find((c) => c.table === 'transactions');
    expect(txCall?.filters).toContainEqual(['in', 'reservation_id', ['r1']]);
  });

  it('skips reservationId-linked tables when the customer has no reservations', async () => {
    const { admin, calls } = makeAdmin({
      customers: [{ id: 'c1', tenant_id: 't1', phone: '2348000000000' }],
      reservations: [],
    });

    const result = await exportCustomerData(admin, { tenantId: 't1', customerId: 'c1' });

    expect(result.tables.transactions).toEqual([]);
    // no query issued against transactions when there are no reservation ids
    expect(calls.find((c) => c.table === 'transactions')).toBeUndefined();
  });
});
