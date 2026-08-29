import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  buildMonthlyReconciliation,
  evaluateDrift,
  findStrandedReservations,
} from '@/lib/billing/messageReconciliation';

// ── queue-based supabase mock (same pattern as messageWallet.test.ts) ────────
type Resp = { data: unknown; error: unknown };
type Chain = Record<string, (...a: unknown[]) => Chain> & {
  then: PromiseLike<Resp>['then'];
};
const responses: Resp[] = [];
function pushDb(data: unknown) { responses.push({ data, error: null }); }
function pushDbErr(error: unknown) { responses.push({ data: null, error }); }
function consume(): Resp { return responses.shift() ?? { data: null, error: null }; }

function makeChain(): Chain {
  const chain = {} as Chain;
  ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'not', 'is', 'in', 'order', 'limit']
    .forEach((m) => { chain[m] = () => chain; });
  chain.then = (onfulfilled, onrejected) =>
    Promise.resolve().then(() => consume()).then(onfulfilled, onrejected);
  return chain;
}
const admin = { from: jest.fn(() => makeChain()) } as never;

// Pin the cost rate: evaluateDrift multiplies by resolveMessageCostCredits(), so an
// unset env would make these assertions depend on the provisional default.
beforeEach(() => {
  responses.length = 0;
  jest.clearAllMocks();
  process.env.BOOKA_MESSAGE_RATE_CREDITS = '14';
  process.env.BOOKA_MESSAGE_RECONCILE_DRIFT_PCT = '2';
});

const base = {
  month: '2026-10', billableMessages: 1000, settledCredits: 22400,
  releasedMessages: 3, freeMessages: 120, byCategory: { service: 800, utility: 200 },
};

describe('buildMonthlyReconciliation', () => {
  it('counts only live rows and aggregates by category', async () => {
    pushDb([
      { billable: true,  settled_credits: 22.4, status: 'settled',  pricing_category: 'service' },
      { billable: true,  settled_credits: 22.4, status: 'settled',  pricing_category: 'utility' },
      { billable: false, settled_credits: 0,    status: 'settled',  pricing_category: 'service' },
      { billable: null,  settled_credits: null, status: 'released', pricing_category: null },
    ]);
    const r = await buildMonthlyReconciliation(admin, '2026-10');
    expect(r).toMatchObject({
      month: '2026-10',
      billableMessages: 2,
      settledCredits: 44.8,
      freeMessages: 1,
      releasedMessages: 1,
    });
    expect(r.byCategory).toEqual({ service: 1, utility: 1 });
  });

  it('returns a zeroed summary for a month with no rows', async () => {
    pushDb([]);
    const r = await buildMonthlyReconciliation(admin, '2026-09');
    expect(r).toMatchObject({
      month: '2026-09', billableMessages: 0, settledCredits: 0,
      freeMessages: 0, releasedMessages: 0,
    });
    expect(r.byCategory).toEqual({});
  });

  it('returns a zeroed summary rather than throwing when the query fails', async () => {
    pushDbErr({ message: 'boom' });
    const r = await buildMonthlyReconciliation(admin, '2026-10');
    expect(r.billableMessages).toBe(0);
  });
});

describe('evaluateDrift', () => {
  it('accepts drift inside tolerance', () => {
    // 1000 billable messages at a 14 cost = 14000 expected
    expect(evaluateDrift(base, 14100)).toMatchObject({ withinTolerance: true });
  });

  it('flags drift beyond tolerance', () => {
    const r = evaluateDrift(base, 16000);
    expect(r.withinTolerance).toBe(false);
    expect(r.driftPct).toBeCloseTo(14.29, 1);
  });

  it('treats a zero Meta cost with zero billable messages as no drift', () => {
    const r = evaluateDrift({ ...base, billableMessages: 0 }, 0);
    expect(r.driftPct).toBe(0);
    expect(r.withinTolerance).toBe(true);
  });

  it('flags a non-zero Meta cost against zero billable messages', () => {
    expect(evaluateDrift({ ...base, billableMessages: 0 }, 500).withinTolerance).toBe(false);
  });
});

describe('findStrandedReservations', () => {
  it('maps rows the sweeper cannot see into reconciliation candidates', async () => {
    pushDb([
      {
        id: 'chg-1', tenant_id: 't1', wallet_reservation_id: 'res-1',
        reserved_credits: 22.4, sent_at: '2026-10-01T00:00:00.000Z',
      },
    ]);
    const r = await findStrandedReservations(admin, 3600_000);
    expect(r).toEqual([{
      chargeId: 'chg-1', tenantId: 't1', walletReservationId: 'res-1',
      reservedCredits: 22.4, sentAt: '2026-10-01T00:00:00.000Z',
    }]);
  });

  it('returns an empty list rather than throwing when the query fails', async () => {
    pushDbErr({ message: 'boom' });
    await expect(findStrandedReservations(admin, 3600_000)).resolves.toEqual([]);
  });
});
