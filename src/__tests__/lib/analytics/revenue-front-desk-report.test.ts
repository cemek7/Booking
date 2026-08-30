import { describe, expect, it, jest } from '@jest/globals';
import { buildRevenueFrontDeskReport } from '@/lib/analytics/revenue-front-desk-report';

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

function makeClient(events: Row[], attributions: Row[]) {
  const eventQuery = makeQuery(events);
  const attributionQuery = makeQuery(attributions);
  const from = jest.fn((table: string) => {
    if (table === 'ai_front_desk_events') return eventQuery.query;
    if (table === 'sias_outcome_attributions') return attributionQuery.query;
    throw new Error(`Unexpected table: ${table}`);
  });

  return { client: { from }, eventQuery, attributionQuery };
}

const period = {
  tenantId: 'tenant-1',
  start: '2026-08-01T00:00:00.000Z',
  end: '2026-08-15T00:00:00.000Z',
};

describe('buildRevenueFrontDeskReport', () => {
  it('separates verified revenue and deterministically deduplicates funnel events', async () => {
    const { client, eventQuery, attributionQuery } = makeClient([
      { id: 'e1', event_type: 'inquiry_received', actor_role: 'system', correlation_id: 'journey-1' },
      { id: 'e2', event_type: 'inquiry_received', actor_role: 'system', correlation_id: 'journey-1' },
      { id: 'e3', event_type: 'lead_qualified', actor_role: 'system', correlation_id: 'journey-1' },
      { id: 'e4', event_type: 'booking_created', actor_role: 'system', correlation_id: 'journey-1' },
      { id: 'e5', event_type: 'upsell_accepted', actor_role: 'assistant', correlation_id: 'journey-2' },
      { id: 'e6', event_type: 'payment_completed', actor_role: 'system', correlation_id: 'journey-2' },
      { id: 'e7', event_type: 'payment_completed', actor_role: 'system', correlation_id: 'journey-2' },
      { id: 'e8', event_type: 'follow_up_sent', actor_role: 'system', correlation_id: 'journey-3' },
      { id: 'e9', event_type: 'handoff_requested', actor_role: 'system', correlation_id: 'journey-4' },
      { id: 'e10', event_type: 'quote_sent', actor_role: null, correlation_id: null },
    ], [
      { id: 'a1', attribution_type: 'processed', verification_status: 'system_verified', amount_cents: 10000, currency: 'NGN' },
      { id: 'a2', attribution_type: 'influenced', verification_status: 'merchant_confirmed', amount_cents: 5000, currency: 'NGN' },
      { id: 'a3', attribution_type: 'recovered', verification_status: 'system_verified', amount_cents: 3000, currency: 'NGN' },
      { id: 'a4', attribution_type: 'influenced', verification_status: 'unverified', amount_cents: 9000, currency: 'NGN' },
      { id: 'a5', attribution_type: 'recovered', verification_status: 'rejected', amount_cents: 8000, currency: 'NGN' },
      { id: 'a6', attribution_type: 'recovered', verification_status: 'merchant_confirmed', amount_cents: null, currency: null },
    ]);

    const report = await buildRevenueFrontDeskReport(client, period);

    expect(report).toEqual({
      period: { start: period.start, end: period.end },
      currency: 'NGN',
      funnel: {
        enquiries: 1,
        qualified: 1,
        bookings: 1,
        sales: 1,
        deposits_or_payments: 1,
        followups_sent: 1,
        recovered_opportunities: 2,
        escalations: 1,
      },
      revenue: {
        processed_cents: 10000,
        influenced_cents: 5000,
        recovered_cents: 3000,
      },
      handling: { automated: 3, human: 1, unresolved: 1 },
      completeness: {
        unverified_attributions: 1,
        missing_amount_events: 1,
        offline_confirmation_required: true,
      },
    });

    for (const query of [eventQuery, attributionQuery]) {
      expect(query.filters).toContainEqual(['eq', 'tenant_id', 'tenant-1']);
      expect(query.filters).toContainEqual(['gte', 'created_at', period.start]);
      expect(query.filters).toContainEqual(['lt', 'created_at', period.end]);
    }
  });

  it('treats events without correlation IDs as separate rows', async () => {
    const { client } = makeClient([
      { id: 'e1', event_type: 'inquiry_received', actor_role: null, correlation_id: null },
      { id: 'e2', event_type: 'inquiry_received', actor_role: null, correlation_id: null },
    ], []);

    const report = await buildRevenueFrontDeskReport(client, period);

    expect(report.funnel.enquiries).toBe(2);
    expect(report.handling.unresolved).toBe(2);
  });

  it('rejects mixed currencies instead of combining unlike money', async () => {
    const { client } = makeClient([], [
      { id: 'a1', attribution_type: 'processed', verification_status: 'system_verified', amount_cents: 10000, currency: 'NGN' },
      { id: 'a2', attribution_type: 'recovered', verification_status: 'merchant_confirmed', amount_cents: 5000, currency: 'USD' },
    ]);

    await expect(buildRevenueFrontDeskReport(client, period)).rejects.toThrow(/multiple currencies/i);
  });
});
