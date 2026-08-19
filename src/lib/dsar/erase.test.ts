import { describe, it, expect } from '@jest/globals';
import { eraseCustomerData } from '@/lib/dsar/erase';

interface Op { table: string; kind: 'update' | 'delete'; payload?: unknown }

function makeAdmin(fixtures: Record<string, unknown[]>) {
  const ops: Op[] = [];
  const admin = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select() { return builder; },
        update(payload: unknown) { ops.push({ table, kind: 'update', payload }); return builder; },
        delete() { ops.push({ table, kind: 'delete' }); return builder; },
        eq() { return builder; },
        or() { return builder; },
        in() { return builder; },
        single() { return Promise.resolve({ data: fixtures[table]?.[0] ?? null, error: null }); },
        then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve({ data: fixtures[table] ?? [], error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { admin: admin as never, ops };
}

const baseFixtures = {
  customers: [{ id: 'c1', tenant_id: 't1', phone: '2348000000000' }],
  reservations: [{ id: 'r1' }],
};

describe('eraseCustomerData', () => {
  it('dry run (default) mutates nothing but reports planned actions', async () => {
    const { admin, ops } = makeAdmin(baseFixtures);
    const report = await eraseCustomerData(admin, { tenantId: 't1', customerId: 'c1' });

    expect(report.dryRun).toBe(true);
    expect(ops.filter((o) => o.kind === 'update' || o.kind === 'delete')).toHaveLength(0);
    expect(report.actions).toContainEqual({ table: 'reservations', op: 'anonymize' });
    expect(report.actions).toContainEqual({ table: 'messages', op: 'delete' });
    expect(report.actions).toContainEqual({ table: 'customers', op: 'anonymize' });
  });

  it('real run anonymizes financial tables, deletes the rest, anonymizes anchor last', async () => {
    const { admin, ops } = makeAdmin(baseFixtures);
    const report = await eraseCustomerData(admin, { tenantId: 't1', customerId: 'c1', dryRun: false });

    expect(report.dryRun).toBe(false);
    // reservations anonymized (scalar PII + raw JSONB cleared), messages deleted
    expect(ops).toContainEqual({ table: 'reservations', kind: 'update', payload: { customer_name: '[erased]', phone: '[erased]', raw: {} } });
    // transactions: no scalar PII, but metadata JSONB cleared (row otherwise kept)
    expect(ops).toContainEqual({ table: 'transactions', kind: 'update', payload: { metadata: {} } });
    expect(ops.some((o) => o.table === 'messages' && o.kind === 'delete')).toBe(true);
    // anchor anonymized with a unique, non-null phone token
    const anchor = ops.find((o) => o.table === 'customers' && o.kind === 'update');
    expect(anchor?.payload).toEqual({ name: '[erased]', phone: 'erased-c1' });
  });

  it('skips reservationId-linked tables when there are no reservations', async () => {
    const { admin, ops } = makeAdmin({ customers: baseFixtures.customers, reservations: [] });
    const report = await eraseCustomerData(admin, { tenantId: 't1', customerId: 'c1', dryRun: false });

    expect(report.actions).toContainEqual({ table: 'transactions', op: 'skip' });
    expect(ops.some((o) => o.table === 'transactions')).toBe(false);
  });
});
