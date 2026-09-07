import { describe, expect, it, jest } from '@jest/globals';

import { detectDuplicates, mergeCustomers } from './merge';
import { BUSINESS_EVENT_ACTIONS } from '@/lib/audit/businessEvents';

jest.mock('@/lib/audit/businessEvents', () => ({
  BUSINESS_EVENT_ACTIONS: {
    CUSTOMER_MERGED: 'customer.merged',
  },
  recordBusinessEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./profile', () => ({
  recomputeProfile: jest.fn().mockResolvedValue(undefined),
}));

function makeAdmin(rows: Record<string, unknown[] | unknown>) {
  const ops: Array<{ table: string; kind: string; payload?: unknown }> = [];
  return {
    __ops: ops,
    from(table: string) {
      const value = rows[table];
      const b: Record<string, unknown> = {
        select() { return b; },
        eq() { return b; },
        in() { return b; },
        is() { return b; },
        maybeSingle() {
          return Promise.resolve({ data: Array.isArray(value) ? value[0] ?? null : value ?? null, error: null });
        },
        then(resolve: (value: { data: unknown; error: null }) => unknown) {
          return Promise.resolve({ data: Array.isArray(value) ? value : value ?? [], error: null }).then(resolve);
        },
        upsert(payload: unknown) {
          ops.push({ table, kind: 'upsert', payload });
          return Promise.resolve({ error: null });
        },
      };
      return b;
    },
    rpc(fn: string, args: unknown) {
      ops.push({ table: fn, kind: 'rpc', payload: args });
      return Promise.resolve({ data: [{ survivor_id: 'cust-1', loser_id: 'cust-2' }], error: null });
    },
  } as never;
}

describe('detectDuplicates', () => {
  it('detects same normalized phone and stores merge candidates', async () => {
    const admin = makeAdmin({
      customers: [
        { id: 'cust-1', normalized_phone: '+2348031234567', email: 'a@test.com', merged_into: null },
        { id: 'cust-2', normalized_phone: '+2348031234567', email: null, merged_into: null },
      ],
    });

    const result = await detectDuplicates(admin, 'tenant-1');

    expect(result).toEqual([
      { customerA: 'cust-1', customerB: 'cust-2', score: 1, reason: 'normalized_phone' },
    ]);
    expect((admin as { __ops: Array<{ table: string; kind: string }> }).__ops.some((entry) => entry.table === 'customer_merge_candidates' && entry.kind === 'upsert')).toBe(true);
  });
});

describe('mergeCustomers', () => {
  it('calls the merge rpc and records customer.merged', async () => {
    const admin = makeAdmin({
      customers: [
        { id: 'cust-1', name: 'Ada', merged_into: null },
        { id: 'cust-2', name: 'Ada Duplicate', merged_into: null },
      ],
    });

    const result = await mergeCustomers(admin, {
      tenantId: 'tenant-1',
      survivorId: 'cust-1',
      loserId: 'cust-2',
      actorId: 'user-1',
    });

    expect(result).toEqual({ survivorId: 'cust-1', loserId: 'cust-2' });
    expect((admin as { __ops: Array<{ table: string; kind: string; payload?: unknown }> }).__ops).toContainEqual({
      table: 'merge_customers_tx',
      kind: 'rpc',
      payload: {
        p_tenant_id: 'tenant-1',
        p_survivor_id: 'cust-1',
        p_loser_id: 'cust-2',
      },
    });
    expect(BUSINESS_EVENT_ACTIONS.CUSTOMER_MERGED).toBe('customer.merged');
  });
});
