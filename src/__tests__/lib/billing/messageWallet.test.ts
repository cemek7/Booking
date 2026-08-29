import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  reserveOutboundMessage,
  attachWamid,
  settleOutboundMessage,
  releaseStaleReservations,
} from '@/lib/billing/messageWallet';

jest.mock('@/lib/billing/spendCaps/spendGuard', () => ({
  checkCaps: jest.fn(),
}));
import { checkCaps } from '@/lib/billing/spendCaps/spendGuard';

// ── queue-based supabase mock ────────────────────────────────────────────────
// Extends the pattern from spendGuard.test.ts with RPC call recording and
// insert/update write recording. The harness never introspects query filters —
// tests assert on what the code does with the rows the mock hands back, and on
// the shape of the writes/RPC calls the code issues.
//
// Two distinct failure shapes are modelled on purpose:
//  - pushErr() / a thrown mock query error: simulates a client-side exception
//    (e.g. a network fault) — the underlying call never resolves normally.
//  - pushDbErr(error) / pushRpcErr(message): simulates a *resolved* call that
//    carries a real Postgrest/RPC error object, e.g. `{code:'23505',...}` or
//    an RPC transport failure — this is what real supabase-js returns for a
//    constraint violation or a failed RPC, and is what the code's error
//    branches actually have to handle.
type Resp = { data: unknown; error: unknown } | { __err: true };
type QueryResp = { data: unknown; error: unknown };
type FluentMethod = (...args: unknown[]) => MockChain;
type MockChain = {
  select: FluentMethod;
  eq: FluentMethod;
  neq: FluentMethod;
  gte: FluentMethod;
  lt: FluentMethod;
  not: FluentMethod;
  is: FluentMethod;
  order: FluentMethod;
  in: FluentMethod;
  insert: (row: Record<string, unknown>) => MockChain;
  update: (row: Record<string, unknown>) => MockChain;
  delete: FluentMethod;
  maybeSingle: () => Promise<QueryResp>;
  single: () => Promise<QueryResp>;
  then: PromiseLike<QueryResp>['then'];
};
type MockClient = {
  from: (table: string) => MockChain;
  rpc: (name: string, args: Record<string, unknown>) => Promise<QueryResp>;
};

const responses: Resp[] = [];
const rpcResponses: Resp[] = [];
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
const updates: Array<{ table: string; row: Record<string, unknown> }> = [];

function pushDb(data: unknown) {
  responses.push({ data, error: null });
}
function pushDbErr(error: unknown) {
  responses.push({ data: null, error });
}
function pushErr() {
  responses.push({ __err: true });
}
function pushRpc(rows: unknown) {
  rpcResponses.push({ data: rows, error: null });
}
function pushRpcErr(message = 'mock rpc error') {
  rpcResponses.push({ data: null, error: { message } });
}

function consume(queue: Resp[]): QueryResp {
  const r = queue.shift() ?? { data: null, error: null };
  if ((r as { __err?: true }).__err) throw new Error('mock query error');
  return r as { data: unknown; error: unknown };
}

function makeChain(table: string): MockChain {
  const chain = {} as MockChain;
  const passthrough: Array<keyof Pick<MockChain, 'select' | 'eq' | 'neq' | 'gte' | 'lt' | 'not' | 'is' | 'order' | 'in' | 'delete'>> =
    ['select', 'eq', 'neq', 'gte', 'lt', 'not', 'is', 'order', 'in', 'delete'];
  passthrough.forEach((method) => { chain[method] = () => chain; });
  chain.insert = (row: Record<string, unknown>) => {
    inserts.push({ table, row });
    return chain;
  };
  chain.update = (row: Record<string, unknown>) => {
    updates.push({ table, row });
    return chain;
  };
  chain.maybeSingle = async () => consume(responses);
  chain.single = async () => consume(responses);
  chain.then = (onfulfilled, onrejected) => Promise.resolve().then(() => consume(responses)).then(onfulfilled, onrejected);
  return chain;
}

const admin: MockClient = {
  from: (table: string) => makeChain(table),
  rpc: async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return consume(rpcResponses);
  },
};
const adminAny = admin as unknown as Parameters<typeof reserveOutboundMessage>[0]['admin'];

beforeEach(() => {
  responses.length = 0;
  rpcResponses.length = 0;
  rpcCalls.length = 0;
  inserts.length = 0;
  updates.length = 0;
});

describe('reserveOutboundMessage', () => {
  beforeEach(() => {
    process.env.BOOKA_MESSAGE_METERING_MODE = 'live';
    process.env.BOOKA_MESSAGE_RATE_CREDITS = '14';
    process.env.BOOKA_MESSAGE_MARKUP = '1.6';
    jest.clearAllMocks();
  });

  it('records a non-meta send for free without touching the wallet', async () => {
    const r = await reserveOutboundMessage({
      admin: adminAny, tenantId: 't1', provider: 'waha', messageKind: 'freeform',
    });
    expect(r).toMatchObject({ allow: true, mode: 'free' });
    expect(rpcCalls).toHaveLength(0);
  });

  it('never gates in shadow mode even with an empty wallet', async () => {
    process.env.BOOKA_MESSAGE_METERING_MODE = 'shadow';
    const r = await reserveOutboundMessage({
      admin: adminAny, tenantId: 't1', provider: 'meta', messageKind: 'freeform',
    });
    expect(r).toMatchObject({ allow: true, mode: 'shadow' });
    expect(rpcCalls).toHaveLength(0);
  });

  it('reserves the sell rate, not the cost rate', async () => {
    (checkCaps as jest.Mock).mockResolvedValue({ allowed: true, degraded: false });
    pushDb({ message_rate_credits: null, grace_overdraft_credits: 100,
             auto_recharge_enabled: false });
    pushRpc([{ allowed: true, balance_credits: 500, reservation_id: 'res-1', reason: 'reserved' }]);
    pushDb({ id: 'charge-1' });
    const r = await reserveOutboundMessage({
      admin: adminAny, tenantId: 't1', provider: 'meta', messageKind: 'freeform',
    });
    expect(r).toMatchObject({ allow: true, mode: 'paid' });
    expect(rpcCalls[0].args.p_amount_credits).toBeCloseTo(22.4, 6);
    expect(rpcCalls[0].args.p_meter).toBe('whatsapp');
  });

  it('hands off when a spend cap refuses', async () => {
    (checkCaps as jest.Mock).mockResolvedValue({ allowed: false, reason: 'daily_cap', degraded: false });
    const r = await reserveOutboundMessage({
      admin: adminAny, tenantId: 't1', provider: 'meta', messageKind: 'freeform',
    });
    expect(r).toEqual({ allow: false, reason: 'handoff' });
  });

  it('routes a degraded cap check into the bounded grace overdraft', async () => {
    (checkCaps as jest.Mock).mockResolvedValue({ allowed: true, degraded: true });
    pushDb({ message_rate_credits: null, grace_overdraft_credits: 100,
             auto_recharge_enabled: false });
    pushRpc([{ allowed: true, balance_credits: -10, reservation_id: 'res-1', reason: 'reserved_grace' }]);
    pushDb({ id: 'charge-1' });
    const r = await reserveOutboundMessage({
      admin: adminAny, tenantId: 't1', provider: 'meta', messageKind: 'freeform',
    });
    expect(r).toMatchObject({ allow: true });
    expect(rpcCalls[0].args.p_allow_overdraft_credits).toBe(100);
  });

  it('falls back to grace when the balance is short and auto-recharge is off', async () => {
    (checkCaps as jest.Mock).mockResolvedValue({ allowed: true, degraded: false });
    pushDb({ message_rate_credits: null, grace_overdraft_credits: 100,
             auto_recharge_enabled: false });
    pushRpc([{ allowed: false, balance_credits: 1, reservation_id: null, reason: 'insufficient_balance' }]);
    pushRpc([{ allowed: true, balance_credits: -21, reservation_id: 'res-2', reason: 'reserved_grace' }]);
    pushDb({ id: 'charge-2' });
    const r = await reserveOutboundMessage({
      admin: adminAny, tenantId: 't1', provider: 'meta', messageKind: 'freeform',
    });
    expect(r).toMatchObject({ allow: true, mode: 'grace' });
  });

  it('hands off when grace is also exhausted', async () => {
    (checkCaps as jest.Mock).mockResolvedValue({ allowed: true, degraded: false });
    pushDb({ message_rate_credits: null, grace_overdraft_credits: 0,
             auto_recharge_enabled: false });
    pushRpc([{ allowed: false, balance_credits: 0, reservation_id: null, reason: 'insufficient_balance' }]);
    pushRpc([{ allowed: false, balance_credits: 0, reservation_id: null, reason: 'insufficient_balance' }]);
    const r = await reserveOutboundMessage({
      admin: adminAny, tenantId: 't1', provider: 'meta', messageKind: 'freeform',
    });
    expect(r).toEqual({ allow: false, reason: 'handoff' });
  });

  // I1: a transport/RPC failure on the reserve call is not a wallet decision
  // ('insufficient_balance') — it must fall through to the safe grace
  // fallback via the outer catch, not be treated as a business handoff.
  it('falls through to the grace fallback when the reserve RPC itself errors, not a handoff', async () => {
    (checkCaps as jest.Mock).mockResolvedValue({ allowed: true, degraded: false });
    pushDb({ message_rate_credits: null, grace_overdraft_credits: 100,
             auto_recharge_enabled: false });
    pushRpcErr('connection reset');
    const r = await reserveOutboundMessage({
      admin: adminAny, tenantId: 't1', provider: 'meta', messageKind: 'freeform',
    });
    expect(r).toEqual({ allow: true, chargeId: null, mode: 'grace' });
  });

  // C2: if the reservation succeeds but the charge-row insert afterward
  // fails, the reservation must be released rather than left stranded with
  // nothing anywhere referencing it.
  it('releases the reservation when the charge row insert fails afterward', async () => {
    (checkCaps as jest.Mock).mockResolvedValue({ allowed: true, degraded: false });
    pushDb({ message_rate_credits: null, grace_overdraft_credits: 100,
             auto_recharge_enabled: false });
    pushRpc([{ allowed: true, balance_credits: 500, reservation_id: 'res-1', reason: 'reserved' }]);
    pushDbErr({ message: 'insert failed' });
    pushRpc([{ allowed: true, balance_credits: 522.4, settlement_id: 's1' }]);
    const r = await reserveOutboundMessage({
      admin: adminAny, tenantId: 't1', provider: 'meta', messageKind: 'freeform',
    });
    expect(r).toEqual({ allow: true, chargeId: null, mode: 'paid' });
    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[1].args).toMatchObject({
      p_reservation_id: 'res-1', p_actual_credits: 0, p_meter: 'whatsapp',
    });
  });
});

describe('attachWamid', () => {
  it('attaches the wamid directly when there is no conflict', async () => {
    pushDb(null); // UPDATE ... SET wamid succeeds
    await attachWamid(adminAny, 'c1', 'wamid.A');
    expect(updates[0]).toMatchObject({
      table: 'whatsapp_message_charges', row: { wamid: 'wamid.A' },
    });
    expect(rpcCalls).toHaveLength(0);
  });

  it('merges a billable orphan and settles the real reservation for the actual amount', async () => {
    pushDbErr({ code: '23505', message: 'duplicate key' }); // first update conflicts
    pushDb({ id: 'c1', tenant_id: 't1', wallet_reservation_id: 'res-1', reserved_credits: 22.4 }); // reserved row
    pushDb({ id: 'orphan-1', billable: true, pricing_category: 'service', pricing_type: 'paid',
             pricing_model: 'PMP', delivery_status: 'delivered' }); // orphan row
    pushDb(null); // delete orphan
    pushRpc([{ allowed: true, balance_credits: 0, settlement_id: 's1' }]); // settle RPC
    pushDb(null); // final merge update

    await attachWamid(adminAny, 'c1', 'wamid.RACE');

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args).toMatchObject({
      p_reservation_id: 'res-1',
      p_estimated_credits: 22.4,
      p_actual_credits: 22.4,
      p_meter: 'whatsapp',
    });
    const finalUpdate = updates[updates.length - 1];
    expect(finalUpdate.row).toMatchObject({
      wamid: 'wamid.RACE', status: 'settled', settled_credits: 22.4, billable: true,
    });
  });

  it('merges a non-billable orphan and settles at zero (full refund)', async () => {
    pushDbErr({ code: '23505', message: 'duplicate key' });
    pushDb({ id: 'c1', tenant_id: 't1', wallet_reservation_id: 'res-1', reserved_credits: 22.4 });
    pushDb({ id: 'orphan-1', billable: false, pricing_category: 'service',
             pricing_type: 'free_customer_service', delivery_status: 'delivered' });
    pushDb(null); // delete orphan
    pushRpc([{ allowed: true, balance_credits: 22.4, settlement_id: 's1' }]);
    pushDb(null); // final merge update

    await attachWamid(adminAny, 'c1', 'wamid.RACE');

    expect(rpcCalls[0].args).toMatchObject({ p_estimated_credits: 22.4, p_actual_credits: 0 });
    const finalUpdate = updates[updates.length - 1];
    expect(finalUpdate.row).toMatchObject({ status: 'settled', settled_credits: 0, billable: false });
  });

  // C1: the orphan's hardcoded settled_credits: 0 must never be copied over a
  // reservation that reserve_ai_wallet_spend already debited. If the settle
  // RPC fails after the orphan is deleted, the row must NOT be finalized —
  // that would silently record zero for money that is still reserved.
  it('leaves the row unmerged for manual reconciliation when the settle RPC fails after the orphan delete', async () => {
    pushDbErr({ code: '23505', message: 'duplicate key' });
    pushDb({ id: 'c1', tenant_id: 't1', wallet_reservation_id: 'res-1', reserved_credits: 22.4 });
    pushDb({ id: 'orphan-1', billable: true, pricing_category: 'service', pricing_type: 'paid',
             pricing_model: 'PMP', delivery_status: 'delivered' });
    pushDb(null); // delete orphan succeeds
    pushRpc([{ allowed: false, balance_credits: 0, settlement_id: null,
               reason: 'insufficient_balance_for_settlement' }]); // settle fails

    await attachWamid(adminAny, 'c1', 'wamid.RACE');

    // Only the initial (conflicting) update happened — no finalizing update
    // with a fabricated settled amount was issued.
    expect(updates).toHaveLength(1);
  });
});

describe('settleOutboundMessage', () => {
  it('does not settle on sent', async () => {
    pushDb({ id: 'c1', status: 'reserved', reserved_credits: 22.4,
             wallet_reservation_id: 'res-1' });
    await settleOutboundMessage({
      admin: adminAny, tenantId: 't1', wamid: 'wamid.A', deliveryStatus: 'sent',
    });
    expect(rpcCalls).toHaveLength(0);
  });

  it('charges the reserved amount when Meta says billable', async () => {
    pushDb({ id: 'c1', status: 'reserved', reserved_credits: 22.4,
             wallet_reservation_id: 'res-1' });
    pushDb([{ id: 'c1' }]); // claim succeeds
    pushRpc([{ allowed: true, balance_credits: 0, settlement_id: 's1' }]);
    await settleOutboundMessage({
      admin: adminAny, tenantId: 't1', wamid: 'wamid.A', deliveryStatus: 'delivered',
      pricing: { billable: true, category: 'service', type: 'paid', pricing_model: 'PMP' },
    });
    expect(rpcCalls[0].args).toMatchObject({
      p_estimated_credits: 22.4, p_actual_credits: 22.4, p_meter: 'whatsapp',
    });
    const claimUpdate = updates[0];
    expect(claimUpdate.row).toMatchObject({
      status: 'settled', settled_credits: 22.4, billable: true, pricing_category: 'service',
    });
  });

  it('refunds in full when Meta says not billable', async () => {
    pushDb({ id: 'c1', status: 'reserved', reserved_credits: 22.4,
             wallet_reservation_id: 'res-1' });
    pushDb([{ id: 'c1' }]);
    pushRpc([{ allowed: true, balance_credits: 22.4, settlement_id: 's1' }]);
    await settleOutboundMessage({
      admin: adminAny, tenantId: 't1', wamid: 'wamid.A', deliveryStatus: 'delivered',
      pricing: { billable: false, category: 'service', type: 'free_customer_service' },
    });
    expect(rpcCalls[0].args).toMatchObject({ p_estimated_credits: 22.4, p_actual_credits: 0 });
    expect(updates[0].row).toMatchObject({ status: 'settled', settled_credits: 0 });
  });

  it('refunds in full on failed delivery', async () => {
    pushDb({ id: 'c1', status: 'reserved', reserved_credits: 22.4,
             wallet_reservation_id: 'res-1' });
    pushDb([{ id: 'c1' }]);
    pushRpc([{ allowed: true, balance_credits: 22.4, settlement_id: 's1' }]);
    await settleOutboundMessage({
      admin: adminAny, tenantId: 't1', wamid: 'wamid.A', deliveryStatus: 'failed',
    });
    expect(rpcCalls[0].args).toMatchObject({ p_estimated_credits: 22.4, p_actual_credits: 0 });
    expect(updates[0].row).toMatchObject({ status: 'released', settled_credits: 0 });
  });

  it('is a no-op on a replayed delivered', async () => {
    pushDb({ id: 'c1', status: 'settled', reserved_credits: 22.4,
             wallet_reservation_id: 'res-1' });
    await settleOutboundMessage({
      admin: adminAny, tenantId: 't1', wamid: 'wamid.A', deliveryStatus: 'delivered',
      pricing: { billable: true },
    });
    expect(rpcCalls).toHaveLength(0);
  });

  // C3: two deliveries racing for the same row (e.g. 'delivered' and 'read'
  // arriving together) must not both call the non-idempotent settle RPC.
  it('does not double-settle when the claim loses a concurrency race', async () => {
    pushDb({ id: 'c1', status: 'reserved', reserved_credits: 22.4,
             wallet_reservation_id: 'res-1' });
    pushDb([]); // claim update matched 0 rows — another call already moved it off 'reserved'
    await settleOutboundMessage({
      admin: adminAny, tenantId: 't1', wamid: 'wamid.A', deliveryStatus: 'delivered',
      pricing: { billable: true },
    });
    expect(rpcCalls).toHaveLength(0);
  });

  // C3: a failed settle RPC must not resurface as a stuck send by marking the
  // row terminal — it must revert to 'reserved' so the sweeper can retry it.
  it('reverts the claim to reserved when the settle RPC fails, leaving the row sweepable', async () => {
    pushDb({ id: 'c1', status: 'reserved', reserved_credits: 22.4,
             wallet_reservation_id: 'res-1' });
    pushDb([{ id: 'c1' }]); // claim succeeds
    pushRpc([{ allowed: false, balance_credits: 0, settlement_id: null,
               reason: 'insufficient_balance_for_settlement' }]);
    await settleOutboundMessage({
      admin: adminAny, tenantId: 't1', wamid: 'wamid.A', deliveryStatus: 'delivered',
      pricing: { billable: true },
    });
    const revertUpdate = updates[updates.length - 1];
    expect(revertUpdate.row).toMatchObject({ status: 'reserved' });
  });

  it('records an orphan row when the charge has no wamid yet', async () => {
    pushDb(null);
    pushDb({ id: 'orphan-1' });
    await settleOutboundMessage({
      admin: adminAny, tenantId: 't1', wamid: 'wamid.RACE', deliveryStatus: 'delivered',
      pricing: { billable: true },
    });
    expect(inserts[0].table).toBe('whatsapp_message_charges');
    expect(inserts[0].row).toMatchObject({ wamid: 'wamid.RACE', billable: true });
  });

  // I3: a failed read must not be treated as "no row" — that would insert an
  // orphan on top of a row that actually exists and lose the settlement to
  // the unique index instead of merging with it.
  it('aborts without inserting an orphan when the initial lookup errors', async () => {
    pushDbErr({ message: 'connection reset' });
    await settleOutboundMessage({
      admin: adminAny, tenantId: 't1', wamid: 'wamid.A', deliveryStatus: 'delivered',
      pricing: { billable: true },
    });
    expect(inserts).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe('settleOutboundMessage — unmetered rows', () => {
  it('records pricing for a shadow row without calling the settle RPC', async () => {
    pushDb({ id: 'c1', status: 'reserved', reserved_credits: 0,
             wallet_reservation_id: null });
    pushDb({ id: 'c1' });
    await settleOutboundMessage({
      admin: adminAny, tenantId: 't1', wamid: 'wamid.S', deliveryStatus: 'delivered',
      pricing: { billable: false, category: 'service', type: 'free_customer_service' },
    });
    expect(rpcCalls).toHaveLength(0);
    expect(updates[0].row).toMatchObject({
      status: 'settled', settled_credits: 0, billable: false, pricing_category: 'service',
    });
  });
});

describe('releaseStaleReservations', () => {
  it('skips any row that somehow arrives without a reservation id', async () => {
    pushDb([
      { id: 'c1', tenant_id: 't1', reserved_credits: 22.4, wallet_reservation_id: null },
      { id: 'c2', tenant_id: 't1', reserved_credits: 22.4, wallet_reservation_id: 'res-2' },
    ]);
    pushDb([{ id: 'c2' }]); // claim for c2 only — c1 is skipped before any DB call
    pushRpc([{ allowed: true, balance_credits: 22.4, settlement_id: 's2' }]);
    const r = await releaseStaleReservations(adminAny, 24 * 60 * 60 * 1000);
    expect(r.released).toBe(1);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args).toMatchObject({ p_meter: 'whatsapp', p_estimated_credits: 22.4 });
  });

  it('releases each stale reservation at zero cost exactly once', async () => {
    pushDb([
      { id: 'c1', tenant_id: 't1', reserved_credits: 22.4, wallet_reservation_id: 'res-1' },
      { id: 'c2', tenant_id: 't1', reserved_credits: 22.4, wallet_reservation_id: 'res-2' },
    ]);
    pushDb([{ id: 'c1' }]); // claim c1
    pushRpc([{ allowed: true, balance_credits: 22.4, settlement_id: 's1' }]);
    pushDb([{ id: 'c2' }]); // claim c2
    pushRpc([{ allowed: true, balance_credits: 44.8, settlement_id: 's2' }]);
    const r = await releaseStaleReservations(adminAny, 24 * 60 * 60 * 1000);
    expect(r.released).toBe(2);
    expect(rpcCalls.every((c) => c.args.p_actual_credits === 0)).toBe(true);
    expect(rpcCalls.every((c) => c.args.p_meter === 'whatsapp')).toBe(true);
  });

  // C3: the sweep query and the per-row claim are not in the same
  // transaction — a webhook can settle a row in that window. Only the call
  // that wins the claim may proceed, and a lost race must not be counted.
  it('does not count a row claimed concurrently by a webhook', async () => {
    pushDb([
      { id: 'c1', tenant_id: 't1', reserved_credits: 22.4, wallet_reservation_id: 'res-1' },
    ]);
    pushDb([]); // claim matched 0 rows — already moved off 'reserved'
    const r = await releaseStaleReservations(adminAny, 24 * 60 * 60 * 1000);
    expect(r.released).toBe(0);
    expect(rpcCalls).toHaveLength(0);
  });

  // C3: a failed settle after a successful claim must revert to 'reserved'
  // rather than report a phantom release.
  it('reverts to reserved when the settle RPC fails, leaving the row sweepable', async () => {
    pushDb([
      { id: 'c1', tenant_id: 't1', reserved_credits: 22.4, wallet_reservation_id: 'res-1' },
    ]);
    pushDb([{ id: 'c1' }]); // claim succeeds
    pushRpc([{ allowed: false, balance_credits: 0, settlement_id: null,
               reason: 'insufficient_balance_for_settlement' }]);
    const r = await releaseStaleReservations(adminAny, 24 * 60 * 60 * 1000);
    expect(r.released).toBe(0);
    const revertUpdate = updates[updates.length - 1];
    expect(revertUpdate.row).toMatchObject({ status: 'reserved' });
  });
});
