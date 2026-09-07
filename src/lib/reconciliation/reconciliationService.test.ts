import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

const mockComputeCloseFromInputs = jest.fn();
const mockRunRules = jest.fn();
const mockRecordBusinessEvent = jest.fn();

jest.mock('./computeClose', () => ({
  computeCloseFromInputs: (...args: unknown[]) => mockComputeCloseFromInputs(...args),
}));

jest.mock('@/lib/anomalies/rules/registry', () => ({
  runRules: (...args: unknown[]) => mockRunRules(...args),
}));

jest.mock('@/lib/audit/businessEvents', () => ({
  BUSINESS_EVENT_ACTIONS: {
    RECONCILIATION_COMPUTED: 'reconciliation.computed',
  },
  recordBusinessEvent: (...args: unknown[]) => mockRecordBusinessEvent(...args),
}));

import { computeDailyClose, resolveDayWindowUtc } from './reconciliationService';

function makeAdmin(rows: Record<string, unknown[] | unknown> = {}) {
  const ops: Array<{ table: string; kind: string; payload?: unknown }> = [];

  const admin = {
    from(table: string) {
      const op = { table, kind: 'select', payload: undefined as unknown };
      ops.push(op);
      const b: Record<string, unknown> = {
        select() { op.kind ||= 'select'; return b; },
        upsert(payload: unknown) { op.kind = 'upsert'; op.payload = payload; return b; },
        insert(payload: unknown) { op.kind = 'insert'; op.payload = payload; return b; },
        update(payload: unknown) { op.kind = 'update'; op.payload = payload; return b; },
        delete() { op.kind = 'delete'; return b; },
        eq() { return b; },
        gte() { return b; },
        gt() { return b; },
        lt() { return b; },
        order() { return b; },
        single() {
          const value = rows[`${table}:${op.kind}:single`] ?? rows[table];
          return Promise.resolve({ data: Array.isArray(value) ? value[0] ?? null : value ?? null, error: null });
        },
        maybeSingle() {
          const value = rows[`${table}:${op.kind}:maybeSingle`] ?? rows[table];
          return Promise.resolve({ data: Array.isArray(value) ? value[0] ?? null : value ?? null, error: null });
        },
        then(resolve: (value: { data: unknown; error: null }) => unknown) {
          const value = rows[`${table}:${op.kind}`] ?? rows[table] ?? [];
          return Promise.resolve({ data: value, error: null }).then(resolve);
        },
      };
      return b;
    },
  };

  return { admin: admin as unknown as SupabaseClient, ops };
}

describe('resolveDayWindowUtc', () => {
  it('maps a tenant-local date to a UTC [start,end) window', () => {
    const { startUtc, endUtc } = resolveDayWindowUtc('2026-07-15', 'Africa/Lagos');
    expect(startUtc).toBe('2026-07-14T23:00:00.000Z');
    expect(endUtc).toBe('2026-07-15T23:00:00.000Z');
  });
});

describe('computeDailyClose', () => {
  it('creates batch anomalies and links matching reconciliation items', async () => {
    mockComputeCloseFromInputs.mockReturnValue({
      expectedRevenueCents: 12000,
      adjustedExpectedCents: 12000,
      recordedPaymentsCents: 0,
      approvedOutstandingCents: 0,
      revenueGapCents: 12000,
      breakdown: {},
      items: [
        {
          itemType: 'unpaid_completed_service',
          severity: 'high',
          entityType: 'reservation',
          entityId: 'reservation-1',
          expectedCents: 12000,
          actualCents: 0,
          differenceCents: 12000,
          detail: {},
        },
      ],
    });

    mockRunRules.mockResolvedValue([
      {
        anomalyId: 'anomaly-1',
        ruleKey: 'completed_service_unpaid',
        domain: 'service',
        severity: 'high',
        entityType: 'reservation',
        entityId: 'reservation-1',
        expectedValueCents: 12000,
        actualValueCents: 0,
        differenceCents: 12000,
        detectionSource: 'reconciliation',
        dedupKey: 'completed_service_unpaid:reservation-1',
        runId: 'run-1',
      },
    ]);

    const { admin, ops } = makeAdmin({
      reservations: [],
      retail_orders: [],
      transactions: [],
      'reconciliation_runs:upsert:single': { id: 'run-1' },
      'reconciliation_items:select': [
        {
          id: 'item-1',
          item_type: 'unpaid_completed_service',
          entity_type: 'reservation',
          entity_id: 'reservation-1',
        },
      ],
    });

    const result = await computeDailyClose(admin, 'tenant-1', '2026-07-20', 'Africa/Lagos');

    expect(result).toEqual({ runId: 'run-1' });
    expect(mockRunRules).toHaveBeenCalledWith(
      admin,
      'tenant-1',
      'batch',
      expect.objectContaining({
        runId: 'run-1',
        window: expect.objectContaining({
          startUtc: '2026-07-19T23:00:00.000Z',
          endUtc: '2026-07-20T23:00:00.000Z',
        }),
      })
    );
    expect(
      ops.find((entry) => entry.table === 'reconciliation_items' && entry.kind === 'update')?.payload
    ).toEqual(expect.objectContaining({ anomaly_id: 'anomaly-1' }));
    expect(mockRecordBusinessEvent).toHaveBeenCalled();
  });
});
