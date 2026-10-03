/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory Supabase/route fakes */
/**
 * Seam tests (final-review A1/A2): the transactions row is written by the real
 * initializeTenantPayment default store, then the real webhook processor,
 * lifecycle and retail-orders modules settle it. Only Supabase I/O, Paystack
 * and outbound messaging/telemetry side effects are mocked.
 */
import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import crypto from 'crypto';

type Row = Record<string, any>;
type Write = { table: string; op: string; payload: any; filters: string[] };

const db: { tables: Record<string, Row[]>; writes: Write[] } = { tables: {}, writes: [] };

function matchNot(row: Row, col: string, op: string, val: string) {
  if (op === 'in') {
    const list = val.replace(/[()"]/g, '').split(',');
    return row[col] !== null && row[col] !== undefined && !list.includes(String(row[col]));
  }
  return true;
}

/** In-memory PostgREST-ish fake; SQL NULL semantics for neq/not. */
function makeClient() {
  return {
    from(table: string) {
      const tbl = (db.tables[table] ??= []);
      let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
      let payload: any = null;
      let wantRows = false;
      const filters: Array<(r: Row) => boolean> = [];
      const desc: string[] = [];
      const run = () => {
        if (op === 'insert') {
          const rows = (Array.isArray(payload) ? payload : [payload]).map((p: Row) => ({ id: p.id ?? `${table}_${tbl.length + 1}`, created_at: new Date().toISOString(), ...p }));
          tbl.push(...rows);
          db.writes.push({ table, op, payload, filters: desc });
          return { data: rows, error: null };
        }
        const matched = tbl.filter((r) => filters.every((f) => f(r)));
        if (op === 'update') {
          matched.forEach((r) => Object.assign(r, payload));
          db.writes.push({ table, op, payload, filters: desc });
          return { data: wantRows ? matched.map((r) => ({ ...r })) : null, error: null };
        }
        if (op === 'delete') {
          db.tables[table] = tbl.filter((r) => !matched.includes(r));
          return { data: null, error: null };
        }
        return { data: matched.map((r) => ({ ...r })), error: null };
      };
      const b: any = {
        select: () => { wantRows = true; return b; },
        insert: (p: any) => { op = 'insert'; payload = p; return b; },
        update: (p: any) => { op = 'update'; payload = p; return b; },
        delete: () => { op = 'delete'; return b; },
        eq: (c: string, v: unknown) => { desc.push(`eq:${c}=${v}`); filters.push((r) => r[c] === v); return b; },
        neq: (c: string, v: unknown) => { desc.push(`neq:${c}=${v}`); filters.push((r) => r[c] !== null && r[c] !== undefined && r[c] !== v); return b; },
        in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b; },
        not: (c: string, o: string, v: string) => { filters.push((r) => matchNot(r, c, o, v)); return b; },
        or: (expr: string) => {
          const parts = expr.split(',').map((p) => p.split('.'));
          filters.push((r) => parts.some(([c, o, v]) => (o === 'is' ? r[c] === null || r[c] === undefined : r[c] !== null && r[c] !== undefined && r[c] !== v)));
          return b;
        },
        order: () => b,
        limit: () => b,
        maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
        single: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      };
      return b;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => makeClient(),
  // A2: webhook-driven code must never touch the anon/cookie client.
  createServerSupabaseClient: () => { throw new Error('anon client used in webhook context'); },
}));

const mockInitSplit = jest.fn();
const mockVerify = jest.fn();
jest.mock('@/lib/paystack', () => ({
  initializeSplitTransaction: (...a: unknown[]) => mockInitSplit(...a),
  verifyTransaction: (...a: unknown[]) => mockVerify(...a),
}));

// Outbound messaging / telemetry side effects (network or unrelated I/O).
jest.mock('@/lib/ai/front-desk-events', () => ({ recordFrontDeskEvent: jest.fn(async () => undefined) }));
jest.mock('@/lib/sias-operations', () => ({ siasOperations: { recordOutcomeAttribution: jest.fn(async () => undefined) } }));
jest.mock('@/lib/chats/journey-service', () => ({ updateChatJourneyByExternalId: jest.fn(async () => undefined) }));
jest.mock('@/lib/whatsapp/v2/conversationState', () => ({ getConversation: jest.fn(async () => null), updateConversation: jest.fn(async () => undefined) }));
jest.mock('@/lib/whatsapp/providers/providerSelection', () => ({
  getTenantChannelProviderClient: jest.fn(async () => null),
  getTenantWhatsAppProviderClient: jest.fn(async () => null),
}));
jest.mock('@/lib/whatsapp/v2/deliverability/governedSend', () => ({ sendGovernedInitiated: jest.fn(async () => ({ sent: false })) }));
jest.mock('@/lib/whatsapp/v2/outboundBranding', () => ({ brandCustomerText: jest.fn(async () => null) }));
jest.mock('@/lib/eventbus/eventBus', () => ({ getEventBus: () => ({ publishEvent: jest.fn(async () => undefined) }) }));
jest.mock('@/lib/observability', () => ({ observability: { recordBusinessMetric: jest.fn() } }));
jest.mock('@/lib/logger', () => ({ defaultLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { initializeTenantPayment } from '@/lib/payments/tenantSettlement';
import { processPaystackWebhook } from '@/lib/payments/paystackWebhookProcessor';

const SECRET = 'sk_test_seam_dummy';
const TENANT = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';
const RESERVATION = '33333333-3333-4333-8333-333333333333';

function seed() {
  db.tables = {
    payment_fee_policies: [{ code: 'pilot_ngn_v1', version: 1, platform_fee_basis_points: 100, platform_fee_cap_minor: 200000, fee_bearer: 'subaccount', active: true }],
    tenant_payment_accounts: [{ tenant_id: TENANT, provider: 'paystack', currency: 'NGN', subaccount_code: 'ACCT_seam', status: 'active', accepted_at: '2026-10-01T00:00:00Z', accepted_by: 'owner-1', policy_code: 'pilot_ngn_v1', policy_version: 1 }],
    transactions: [],
    webhook_events: [],
    tenant_revenue_ledger: [],
    escalation_queue: [],
    retail_orders: [{
      id: ORDER, tenant_id: TENANT, cart_id: null, customer_id: null, external_customer_ref: '+2348000000001',
      status: 'pending_payment', payment_status: 'pending', fulfillment_status: 'unfulfilled', currency: 'NGN',
      subtotal_cents: 500000, total_cents: 500000, metadata: { payment: { channel: 'whatsapp' } },
    }],
    reservations: [{ id: RESERVATION, tenant_id: TENANT, status: 'pending', start_at: '2026-10-05T10:00:00Z', end_at: null, customer_number: null, notes: null, service_id: 'svc-1', metadata: {} }],
    services: [{ id: 'svc-1', tenant_id: TENANT, name: 'Braids', duration: 60 }],
    tenants: [{ id: TENANT, name: 'Biz', metadata: {}, settings: {} }],
  };
  db.writes = [];
}

async function checkout(subject: { type: 'retail_order' | 'reservation'; id: string }, amountMinor: number) {
  const res = await initializeTenantPayment({
    tenantId: TENANT, amountMinor, currency: 'NGN', customerEmail: 'buyer@example.org',
    subject, idempotencyKey: `${subject.type}:${subject.id}:${amountMinor}`,
  });
  if (!res.ok) throw new Error(`checkout failed: ${res.code}`);
  return res;
}

function deliver(reference: string) {
  const raw = JSON.stringify({ event: 'charge.success', data: { reference } });
  const signature = crypto.createHmac('sha512', SECRET).update(raw).digest('hex');
  return processPaystackWebhook({ rawBody: raw, signature });
}

describe('settlement seams: initializeTenantPayment row -> webhook -> subject', () => {
  const env = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    seed();
    process.env.BOOKA_TENANT_PAYMENTS = 'live';
    process.env.PAYSTACK_SECRET_KEY = SECRET;
    delete process.env.BOOKA_RETAIL_FULFILLMENT_MODE;
    mockInitSplit.mockImplementation(async () => ({ success: true, authorizationUrl: 'https://checkout.paystack.test/x' }));
  });
  afterEach(() => { process.env = { ...env }; });

  it('A1: a paid retail checkout marks the order paid by subject_id', async () => {
    const co = await checkout({ type: 'retail_order', id: ORDER }, 500000);
    const tx = db.tables.transactions[0];
    // The row is exactly what the default store writes: subject columns, no retail fields in raw.
    expect(tx).toMatchObject({ subject_type: 'retail_order', subject_id: ORDER, amount_minor: 500000, settlement_verification_status: 'pending' });
    expect(tx.raw.retail_order_id).toBeUndefined();
    expect(tx.raw.external_customer_ref).toBeUndefined();

    mockVerify.mockImplementation(async () => ({ success: true, data: {
      status: 'success', reference: co.reference, amountMinor: 500000, currency: 'NGN', feesMinor: 7500, subaccountCode: 'ACCT_seam',
    } }));
    const res = await deliver(co.reference);
    expect(res).toMatchObject({ status: 200, body: { outcome: 'verified' } });

    const order = db.tables.retail_orders[0];
    expect(order).toMatchObject({ status: 'paid', payment_status: 'paid' });
    expect(order.metadata.paidReference).toBe(co.reference);
    const orderUpdate = db.writes.find((w) => w.table === 'retail_orders' && w.op === 'update' && w.payload.payment_status === 'paid');
    expect(orderUpdate?.filters).toEqual(expect.arrayContaining([`eq:tenant_id=${TENANT}`, `eq:id=${ORDER}`]));

    const settled = db.tables.transactions[0];
    expect(settled).toMatchObject({ status: 'success', settlement_verification_status: 'verified' });
    expect(settled.settlement_effects_completed_at).toEqual(expect.any(String));
    // The paid reference was updated and its settlement raw kept intact.
    expect(settled.raw.authorization_url).toBe('https://checkout.paystack.test/x');
    expect(db.tables.tenant_revenue_ledger).toHaveLength(1);
  });

  it('A2: a paid reservation deposit confirms the reservation through the service client', async () => {
    const co = await checkout({ type: 'reservation', id: RESERVATION }, 200000);
    mockVerify.mockImplementation(async () => ({ success: true, data: {
      status: 'success', reference: co.reference, amountMinor: 200000, currency: 'NGN', feesMinor: 3000, subaccountCode: 'ACCT_seam',
    } }));
    const res = await deliver(co.reference);
    expect(res).toMatchObject({ status: 200, body: { outcome: 'verified' } });
    expect(db.tables.reservations[0].status).toBe('confirmed');
    const resUpdate = db.writes.find((w) => w.table === 'reservations' && w.op === 'update');
    expect(resUpdate?.payload).toEqual({ status: 'confirmed' });
    expect(resUpdate?.filters).toEqual(expect.arrayContaining([`eq:id=${RESERVATION}`, `eq:tenant_id=${TENANT}`]));
  });

  it('B3: an older, lower checkout settling after the total rose does not mark the order paid', async () => {
    const old = await checkout({ type: 'retail_order', id: ORDER }, 400000);
    db.tables.retail_orders[0].total_cents = 500000; // e.g. delivery fee added later
    mockVerify.mockImplementation(async () => ({ success: true, data: {
      status: 'success', reference: old.reference, amountMinor: 400000, currency: 'NGN', feesMinor: 6000, subaccountCode: 'ACCT_seam',
    } }));
    const res = await deliver(old.reference);
    expect(res).toMatchObject({ status: 200, body: { outcome: 'verified' } });
    expect(db.tables.retail_orders[0].payment_status).toBe('pending');
    expect(db.tables.escalation_queue).toHaveLength(1);
    expect(db.tables.escalation_queue[0]).toMatchObject({
      tenant_id: TENANT, reason_code: 'payment_settlement', session_id: `settlement:${old.reference}`,
      customer_phone: '+2348000000001', retail_order_id: ORDER,
    });
  });
});
