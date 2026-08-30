import { describe, expect, it, jest } from '@jest/globals';
import { buildBookaUnitEconomics } from '@/lib/analytics/booka-unit-economics';

type Row = Record<string, unknown>;

function makeQuery(data: Row[]) {
  const filters: Array<[string, string, unknown]> = [];
  const query: Record<string, unknown> = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn((column: string, value: unknown) => {
    filters.push(['eq', column, value]);
    return query;
  });
  query.gte = jest.fn((column: string, value: unknown) => {
    filters.push(['gte', column, value]);
    return query;
  });
  query.lt = jest.fn((column: string, value: unknown) => {
    filters.push(['lt', column, value]);
    return query;
  });
  query.then = (resolve: (value: unknown) => unknown) => resolve({ data, error: null });
  return { query, filters };
}

function makeClient(rows: {
  revenue?: Row[];
  cost?: Row[];
  events?: Row[];
  attributions?: Row[];
}) {
  const queries = {
    tenant_revenue_ledger: makeQuery(rows.revenue ?? []),
    tenant_cost_ledger: makeQuery(rows.cost ?? []),
    ai_front_desk_events: makeQuery(rows.events ?? []),
    sias_outcome_attributions: makeQuery(rows.attributions ?? []),
  };
  const from = jest.fn((table: keyof typeof queries) => queries[table].query);
  return { client: { from }, queries };
}

const period = {
  start: '2026-08-01T00:00:00.000Z',
  end: '2026-09-01T00:00:00.000Z',
};

describe('buildBookaUnitEconomics', () => {
  it('keeps tenants separate and derives contribution from ledger values only', async () => {
    const { client, queries } = makeClient({
      revenue: [
        { tenant_id: 'tenant-1', revenue_type: 'usage_charge', amount_credits: 100 },
        { tenant_id: 'tenant-1', revenue_type: 'subscription_charge', amount_credits: 50 },
        { tenant_id: 'tenant-1', revenue_type: 'refund', amount_credits: -10 },
        { tenant_id: 'tenant-1', revenue_type: 'wallet_topup', amount_credits: 200 },
        { tenant_id: 'tenant-2', revenue_type: 'usage_charge', amount_credits: 80 },
      ],
      cost: [
        { tenant_id: 'tenant-1', cost_type: 'llm', actual_cost_credits: 20 },
        { tenant_id: 'tenant-1', cost_type: 'whatsapp', actual_cost_credits: 10 },
        { tenant_id: 'tenant-1', cost_type: 'server', actual_cost_credits: 5 },
        { tenant_id: 'tenant-1', cost_type: 'payment', actual_cost_credits: 2 },
      ],
      events: [
        { id: 'e1', tenant_id: 'tenant-1', correlation_id: 'conversation-1' },
        { id: 'e2', tenant_id: 'tenant-1', correlation_id: 'conversation-1' },
        { id: 'e3', tenant_id: 'tenant-1', correlation_id: null },
        { id: 'e4', tenant_id: 'tenant-2', correlation_id: 'conversation-2' },
      ],
      attributions: [
        { id: 'a1', tenant_id: 'tenant-1', attribution_type: 'processed', verification_status: 'system_verified' },
        { id: 'a2', tenant_id: 'tenant-1', attribution_type: 'influenced', verification_status: 'merchant_confirmed' },
        { id: 'a3', tenant_id: 'tenant-1', attribution_type: 'recovered', verification_status: 'unverified' },
        { id: 'a4', tenant_id: 'tenant-2', attribution_type: 'processed', verification_status: 'system_verified' },
      ],
    });

    const result = await buildBookaUnitEconomics(client, period);

    expect(result.tenants).toHaveLength(2);
    expect(result.tenants[0]).toMatchObject({
      tenant_id: 'tenant-1',
      recognized_revenue_credits: 140,
      provider_cost_credits: 37,
      costs_by_type: { llm: 20, whatsapp: 10, server: 5, payment: 2, manual_adjustment: 0 },
      gross_contribution_credits: 103,
      conversation_volume: 2,
      verified_outcomes: 2,
      cost_per_verified_outcome_credits: 18.5,
      cost_capture_complete: true,
    });
    expect(result.tenants[0].gross_margin_percent).toBeCloseTo(73.57142857142857);
    expect(result.tenants[1]).toMatchObject({
      tenant_id: 'tenant-2',
      recognized_revenue_credits: 80,
      provider_cost_credits: 0,
      gross_contribution_credits: 80,
      gross_margin_percent: 100,
      conversation_volume: 1,
      verified_outcomes: 1,
      cost_per_verified_outcome_credits: 0,
      cost_capture_complete: false,
    });
    expect(result.totals).toMatchObject({
      recognized_revenue_credits: 220,
      provider_cost_credits: 37,
      gross_contribution_credits: 183,
      verified_outcomes: 3,
      conversation_volume: 3,
      cost_capture_complete: false,
    });

    for (const query of Object.values(queries)) {
      expect(query.filters).toContainEqual(['gte', 'created_at', period.start]);
      expect(query.filters).toContainEqual(['lt', 'created_at', period.end]);
    }
  });

  it('returns null ratios for zero revenue and zero verified outcomes', async () => {
    const { client } = makeClient({
      cost: [{ tenant_id: 'tenant-3', cost_type: 'llm', actual_cost_credits: 5 }],
      events: [{ id: 'e1', tenant_id: 'tenant-3', correlation_id: 'conversation-3' }],
    });

    const result = await buildBookaUnitEconomics(client, period);

    expect(result.tenants[0]).toMatchObject({
      recognized_revenue_credits: 0,
      provider_cost_credits: 5,
      gross_contribution_credits: -5,
      gross_margin_percent: null,
      verified_outcomes: 0,
      cost_per_verified_outcome_credits: null,
    });
  });

  it('applies a tenant filter to every source query', async () => {
    const { client, queries } = makeClient({});

    await buildBookaUnitEconomics(client, { ...period, tenantId: 'tenant-9' });

    for (const query of Object.values(queries)) {
      expect(query.filters).toContainEqual(['eq', 'tenant_id', 'tenant-9']);
    }
  });

  it('does not treat a manual cost adjustment as provider-cost capture', async () => {
    const { client } = makeClient({
      cost: [{ tenant_id: 'tenant-4', cost_type: 'manual_adjustment', actual_cost_credits: 3 }],
      events: [{ id: 'e1', tenant_id: 'tenant-4', correlation_id: 'conversation-4' }],
    });

    const result = await buildBookaUnitEconomics(client, period);

    expect(result.tenants[0].cost_capture_complete).toBe(false);
  });
});
