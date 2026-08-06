import { describe, expect, it, jest, beforeEach } from '@jest/globals';

const mockValidateAction = jest.fn();
const mockExecuteAction = jest.fn();
const mockRecordBusinessEvent = jest.fn();

jest.mock('@/lib/booking/action-validator', () => ({
  validateAction: (...args: unknown[]) => mockValidateAction(...args),
  executeAction: (...args: unknown[]) => mockExecuteAction(...args),
}));

jest.mock('@/lib/audit/businessEvents', () => ({
  BUSINESS_EVENT_ACTIONS: {
    RECOMMENDATION_ACCEPTED: 'recommendation.accepted',
    RECOMMENDATION_DISMISSED: 'recommendation.dismissed',
    RECOMMENDATION_SNOOZED: 'recommendation.snoozed',
    RECOMMENDATION_OUTCOME_RECORDED: 'recommendation.outcome_recorded',
    RECOMMENDATION_ALERTED: 'recommendation.alerted',
  },
  recordBusinessEvent: (...args: unknown[]) => mockRecordBusinessEvent(...args),
}));

import {
  decideRecommendation,
  deriveRecommendationThresholds,
  observeOutcomes,
} from './outcomes';

function makeAdmin(rows: Record<string, unknown[] | unknown> = {}) {
  const ops: Array<{ table: string; kind: string; payload?: unknown }> = [];
  const admin = {
    from(table: string) {
      const op = { table, kind: '', payload: undefined as unknown };
      ops.push(op);
      const builder: Record<string, unknown> = {
        select() { op.kind ||= 'select'; return builder; },
        update(payload: unknown) { op.kind = 'update'; op.payload = payload; return builder; },
        insert(payload: unknown) { op.kind = 'insert'; op.payload = payload; return builder; },
        eq() { return builder; },
        in() { return builder; },
        gt() { return builder; },
        gte() { return builder; },
        lt() { return builder; },
        order() { return builder; },
        not() { return builder; },
        maybeSingle() {
          const values = rows[table];
          const row = Array.isArray(values) ? values.shift() ?? null : values ?? null;
          return Promise.resolve({ data: row, error: null });
        },
        single() {
          const values = rows[table];
          const row = Array.isArray(values) ? values.shift() ?? null : values ?? null;
          return Promise.resolve({ data: row, error: null });
        },
        then(resolve: (value: { data: unknown; error: null }) => unknown) {
          const values = rows[table];
          const data = Array.isArray(values) ? values : values ?? [];
          return Promise.resolve(resolve({ data, error: null }));
        },
      };
      return builder;
    },
  };
  return { admin: admin as never, ops };
}

beforeEach(() => {
  mockValidateAction.mockReset();
  mockExecuteAction.mockReset();
  mockRecordBusinessEvent.mockReset();
});

describe('deriveRecommendationThresholds', () => {
  it('widens or tightens thresholds from deterministic outcome rates', async () => {
    const { admin } = makeAdmin({
      recommendation_outcomes: [
        { outcome: 'acted', recommendation: { type: 'likely_stockout' } },
        { outcome: 'acted', recommendation: { type: 'likely_stockout' } },
        { outcome: 'expired', recommendation: { type: 'likely_stockout' } },
        { outcome: 'expired', recommendation: { type: 'reactivation' } },
        { outcome: 'expired', recommendation: { type: 'reactivation' } },
        { outcome: 'expired', recommendation: { type: 'reactivation' } },
      ],
    });

    const thresholds = await deriveRecommendationThresholds(admin, 'tenant-1');

    expect(thresholds.likelyStockoutDays).toBe(21);
    expect(thresholds.reactivationDays).toBe(60);
  });
});

describe('decideRecommendation', () => {
  it('executes actionable purchase recommendations through the action layer', async () => {
    mockValidateAction.mockResolvedValueOnce({ valid: true });
    mockExecuteAction.mockResolvedValueOnce({ success: true, data: { purchase: { id: 'purchase-1' } } });
    mockRecordBusinessEvent.mockResolvedValue(undefined);

    const recommendation = {
      id: 'rec-1',
      tenant_id: 'tenant-1',
      type: 'reorder_qty',
      title: 'Top up Relaxer',
      reason: 'Need more stock.',
      recommended_action: 'Record a purchase.',
      basis: { product_id: 'p1', suggested_reorder_quantity: 5 },
      confidence: 0.9,
      status: 'pending',
      entity_id: 'p1',
      created_at: '2026-07-20T00:00:00.000Z',
    };

    const { admin } = makeAdmin({
      business_recommendations: [recommendation, { ...recommendation, status: 'accepted' }],
      products: [{ id: 'p1', name: 'Relaxer', cost_price_cents: 800, price_cents: 2500, low_stock_threshold: 2, stock_quantity: 1 }],
    });

    const result = await decideRecommendation(admin, {
      tenantId: 'tenant-1',
      recommendationId: 'rec-1',
      decision: 'accept',
      actorId: 'user-1',
      permissions: ['RECORD_PURCHASES'],
    });

    expect(mockValidateAction).toHaveBeenCalled();
    expect(mockExecuteAction).toHaveBeenCalled();
    expect(result.execution).toEqual(
      expect.objectContaining({
        executed: true,
        manualOnly: false,
        actionId: 'record_purchase',
      }),
    );
  });

  it('keeps non-executable recommendations explicit and manual', async () => {
    mockRecordBusinessEvent.mockResolvedValue(undefined);

    const recommendation = {
      id: 'rec-2',
      tenant_id: 'tenant-1',
      type: 'bundle',
      title: 'Bundle Relaxer',
      reason: 'Companion items exist.',
      recommended_action: 'Create a bundle.',
      basis: { base_product_id: 'p1' },
      confidence: 0.7,
      status: 'pending',
      entity_id: 'p1',
      created_at: '2026-07-20T00:00:00.000Z',
    };

    const { admin } = makeAdmin({
      business_recommendations: [recommendation, { ...recommendation, status: 'accepted' }],
    });

    const result = await decideRecommendation(admin, {
      tenantId: 'tenant-1',
      recommendationId: 'rec-2',
      decision: 'accept',
      actorId: 'user-1',
      permissions: ['VIEW_ANALYTICS'],
    });

    expect(mockValidateAction).not.toHaveBeenCalled();
    expect(mockExecuteAction).not.toHaveBeenCalled();
    expect(result.execution).toEqual(
      expect.objectContaining({
        executed: false,
        manualOnly: true,
        actionId: null,
      }),
    );
  });
});

describe('observeOutcomes', () => {
  it('records acted outcomes when subsequent stock movements appear', async () => {
    mockRecordBusinessEvent.mockResolvedValue(undefined);

    const { admin, ops } = makeAdmin({
      business_recommendations: [
        {
          id: 'rec-3',
          tenant_id: 'tenant-1',
          type: 'likely_stockout',
          title: 'Reorder Relaxer soon',
          reason: 'Soon out of stock.',
          recommended_action: 'Buy more now.',
          basis: { product_id: 'p1' },
          confidence: 0.9,
          status: 'pending',
          entity_id: 'p1',
          created_at: '2026-07-20T00:00:00.000Z',
        },
      ],
      recommendation_outcomes: [],
      inventory_movements: [{ id: 'move-1' }],
    });

    const summary = await observeOutcomes(admin, 'tenant-1', new Date('2026-07-21T00:00:00.000Z'));

    expect(summary).toEqual({ acted: 1, expired: 0, ignored: 0 });
    expect(ops.find((entry) => entry.table === 'recommendation_outcomes' && entry.kind === 'insert')?.payload).toEqual(
      expect.objectContaining({
        recommendation_id: 'rec-3',
        outcome: 'acted',
      }),
    );
  });
});
