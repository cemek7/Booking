/**
 * Tests for sendRebookingFollowUps and sendRebookingNudges
 *
 * Both functions drive WhatsApp re-engagement messages via Evolution API.
 * They are complex DB-heavy functions; tests focus on the skip/send decision
 * branches rather than every query permutation.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ── Supabase mock ──────────────────────────────────────────────────────────
// Supports both maybeSingle() and direct-await (thenable) patterns.

type DbResponse = { data: unknown; count?: number; error?: unknown };
const responses: DbResponse[] = [];

function pushDb(data: unknown, count = 0) {
  responses.push({ data, count, error: null });
}

function consume(): DbResponse {
  return responses.shift() ?? { data: null, count: 0, error: null };
}

function makeChain() {
  const chain: any = {};
  const filters = ['select', 'eq', 'neq', 'ilike', 'in', 'lt', 'gt', 'lte', 'gte', 'not'];
  filters.forEach(m => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });

  // Terminal via explicit call
  chain.maybeSingle = jest.fn().mockImplementation(() => Promise.resolve(consume()));
  chain.single      = jest.fn().mockImplementation(() => Promise.resolve(consume()));
  chain.insert      = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.upsert      = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.update      = jest.fn().mockReturnValue(chain);

  // Thenable for: `await chain.eq(...)` or `await supabase.from().select()...`
  chain.then = (onFulfilled: (v: DbResponse) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(consume()).then(onFulfilled, onRejected);

  return chain;
}

const mockClient = { from: jest.fn().mockImplementation(() => makeChain()) };

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => mockClient) }));
jest.mock('@/lib/whatsapp/v2/outboundBranding', () => ({
  brandCustomerText: jest.fn(async (_tenantId: string, _phone: string, reply: string) => reply),
}));
jest.mock('@/lib/monitoring/telegramAlert', () => ({
  sendTelegramInfo:  jest.fn().mockResolvedValue(undefined),
  sendTelegramAlert: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('next/server', () => ({
  NextResponse: { json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body: data }) },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { sendRebookingFollowUps, sendRebookingNudges } from '@/app/api/cron/nightly/route';

// ── Shared fixtures ────────────────────────────────────────────────────────

const FOUR_DAYS_AGO = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();

function validReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'res_1',
    tenant_id: 'tenant_1',
    customer_phone: '+2348012345678',
    customer_name: 'Ada',
    service_id: 'svc_1',
    start_at: FOUR_DAYS_AGO,
    services: { name: 'Trim', rebooking_interval_days: 30 },
    tenants:  { v2_enabled: true, settings: {} },
    ...overrides,
  };
}

const WA_CONFIG = {
  instance_name: 'test-instance',
  api_url: 'https://wa.test',
  api_key: 'apikey_test',
};

// ═══════════════════════════════════════════════════════════════════════════
// sendRebookingFollowUps
// ═══════════════════════════════════════════════════════════════════════════

describe('sendRebookingFollowUps', () => {
  beforeEach(() => {
    responses.length = 0;
    mockFetch.mockReset();
    jest.clearAllMocks();
  });

  it('returns 0 when no reservations fall in the 3–4 day window', async () => {
    pushDb([]); // initial reservations query (direct-await)
    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(0);
  });

  it('skips reservation when tenant is not v2_enabled', async () => {
    pushDb([validReservation({ tenants: { v2_enabled: false, settings: {} } })]);
    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(0);
  });

  it('skips reservation when service has no rebooking_interval_days', async () => {
    pushDb([validReservation({ services: { name: 'Trim', rebooking_interval_days: null } })]);
    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(0);
  });

  it('skips reservation when customer_phone is null', async () => {
    pushDb([validReservation({ customer_phone: null })]);
    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(0);
  });

  it('skips when customer is not found in the customers table', async () => {
    pushDb([validReservation()]); // initial query
    pushDb(null);                 // customers → not found (maybeSingle)
    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(0);
  });

  it('skips when a follow-up was already sent for this customer+service', async () => {
    pushDb([validReservation()]);
    // Customer has follow-up already recorded
    pushDb({ id: 'cust_1', metadata: { rebooking_followup_sent_at: { svc_1: '2026-01-01T00:00:00Z' } } });
    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(0);
  });

  it('skips when customer has a newer reservation for the same service', async () => {
    pushDb([validReservation()]);
    pushDb({ id: 'cust_1', metadata: {} }); // customers (maybeSingle)
    pushDb(null, 1);                        // newer count (direct-await) → count: 1
    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(0);
  });

  it('skips when no WhatsApp config is found for the tenant', async () => {
    pushDb([validReservation()]);
    pushDb({ id: 'cust_1', metadata: {} }); // customers
    pushDb(null, 0);                        // newer count → 0
    pushDb(null);                           // whatsapp_configs (maybeSingle) → not found
    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(0);
  });

  it('skips and does not update metadata when Evolution API returns non-ok', async () => {
    pushDb([validReservation()]);
    pushDb({ id: 'cust_1', metadata: {} });
    pushDb(null, 0);
    pushDb(WA_CONFIG);
    // Push a sentinel — if the update runs it will consume this; if not it stays
    pushDb({ sentinel: true });
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(0);
    // Sentinel must still be in the queue (update path was skipped)
    expect(responses).toHaveLength(1);
    expect((responses[0].data as any)?.sentinel).toBe(true);
  });

  it('sends follow-up and updates metadata on happy path', async () => {
    const res = validReservation();
    pushDb([res]);
    pushDb({ id: 'cust_1', metadata: {} });
    pushDb(null, 0);   // newer count
    pushDb(WA_CONFIG); // wa config
    // Customer update (direct-await)
    pushDb(null);

    mockFetch.mockResolvedValue({ ok: true });

    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(1);

    // Verify Evolution API was called
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('sendText'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('+2348012345678'),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// sendRebookingNudges
// ═══════════════════════════════════════════════════════════════════════════

describe('sendRebookingNudges', () => {
  beforeEach(() => {
    responses.length = 0;
    mockFetch.mockReset();
    jest.clearAllMocks();
  });

  it('returns 0 when there are no v2-enabled tenants', async () => {
    pushDb([]); // tenants (direct-await)
    const sent = await sendRebookingNudges();
    expect(sent).toBe(0);
  });

  it('skips tenant when no services have rebooking_interval_days set', async () => {
    pushDb([{ id: 'tenant_1', settings: {} }]); // tenants
    pushDb([]);                                  // services → empty (direct-await)
    const sent = await sendRebookingNudges();
    expect(sent).toBe(0);
  });

  it('skips tenant when no WhatsApp config is found', async () => {
    pushDb([{ id: 'tenant_1', settings: {} }]);
    pushDb([{ id: 'svc_1', name: 'Trim', rebooking_interval_days: 30 }]);
    pushDb(null); // waConfig → not found (maybeSingle)
    const sent = await sendRebookingNudges();
    expect(sent).toBe(0);
  });

  it('skips service when no completed reservations are older than the cutoff', async () => {
    pushDb([{ id: 'tenant_1', settings: {} }]);
    pushDb([{ id: 'svc_1', name: 'Trim', rebooking_interval_days: 30 }]);
    pushDb(WA_CONFIG);
    pushDb([]); // reservations before cutoff → empty
    const sent = await sendRebookingNudges();
    expect(sent).toBe(0);
  });

  it('skips customer when a newer booking already exists', async () => {
    const oldStart = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    pushDb([{ id: 'tenant_1', settings: {} }]);
    pushDb([{ id: 'svc_1', name: 'Trim', rebooking_interval_days: 30 }]);
    pushDb(WA_CONFIG);
    pushDb([{ customer_phone: '+2348012345678', customer_name: 'Ada', start_at: oldStart }]);
    pushDb(null, 1); // newer count (direct-await) → count: 1
    const sent = await sendRebookingNudges();
    expect(sent).toBe(0);
  });

  it('skips customer when customer record is not found', async () => {
    const oldStart = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    pushDb([{ id: 'tenant_1', settings: {} }]);
    pushDb([{ id: 'svc_1', name: 'Trim', rebooking_interval_days: 30 }]);
    pushDb(WA_CONFIG);
    pushDb([{ customer_phone: '+2348012345678', customer_name: 'Ada', start_at: oldStart }]);
    pushDb(null, 0); // newer count → 0
    pushDb(null);    // customer (maybeSingle) → not found
    const sent = await sendRebookingNudges();
    expect(sent).toBe(0);
  });

  it('skips customer when nudge was sent within the throttle window', async () => {
    const intervalDays = 30;
    const oldStart = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    // Last nudge sent 10 days ago — within throttle (interval/2 = 15 days)
    const lastNudgeAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    pushDb([{ id: 'tenant_1', settings: {} }]);
    pushDb([{ id: 'svc_1', name: 'Trim', rebooking_interval_days: intervalDays }]);
    pushDb(WA_CONFIG);
    pushDb([{ customer_phone: '+2348012345678', customer_name: 'Ada', start_at: oldStart }]);
    pushDb(null, 0);
    pushDb({ id: 'cust_1', metadata: { rebooking_nudge_sent_at: { svc_1: lastNudgeAt } } });

    const sent = await sendRebookingNudges();
    expect(sent).toBe(0);
  });

  it('sends nudge and updates metadata on happy path', async () => {
    const oldStart = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

    pushDb([{ id: 'tenant_1', settings: {} }]);
    pushDb([{ id: 'svc_1', name: 'Trim', rebooking_interval_days: 30 }]);
    pushDb(WA_CONFIG);
    pushDb([{ customer_phone: '+2348012345678', customer_name: 'Ada', start_at: oldStart }]);
    pushDb(null, 0); // newer count
    pushDb({ id: 'cust_1', metadata: {} }); // customer (no prior nudge)
    // customer update (direct-await)
    pushDb(null);

    mockFetch.mockResolvedValue({ ok: true });

    const sent = await sendRebookingNudges();
    expect(sent).toBe(1);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('sendText'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('BOOK'),
      })
    );
  });
});
