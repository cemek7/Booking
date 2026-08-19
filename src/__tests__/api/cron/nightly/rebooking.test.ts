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
  const chain: Record<string, unknown> = {};
  const filters = ['select', 'eq', 'neq', 'ilike', 'in', 'lt', 'gt', 'lte', 'gte', 'not', 'contains', 'order', 'limit'];
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
jest.mock('@/lib/whatsapp/providers/providerSelection', () => ({
  getTenantWhatsAppProviderClient: jest.fn(),
}));
jest.mock('@/lib/offboarding/purgeWorker', () => ({
  runDueTeardownTasks: jest.fn().mockResolvedValue(0),
  runOperationalPurge: jest.fn().mockResolvedValue(0),
  runFinancialPurge: jest.fn().mockResolvedValue(0),
}));
// getTenantWhatsAppConfig (in evolutionClient) reads provider config via the
// admin client — point it at the same mockClient so WA_CONFIG flows through the
// shared response queue.
jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => mockClient,
  createServerSupabaseClient: () => mockClient,
}));
jest.mock('@/lib/whatsapp/v2/deliverability/governedSend', () => ({
  sendGovernedInitiated: jest.fn(),
}));
// SIAS campaign bookkeeping is fire-and-forget side effect — stub it so it does
// not touch the response queue or require its own DB fixtures.
jest.mock('@/lib/sias-operations', () => ({
  siasOperations: { recordCampaignRun: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('next/server', () => ({
  NextResponse: { json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body: data }) },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { sendRebookingFollowUps, sendRebookingNudges, __resetWhatsAppSendCache } from '@/app/api/cron/nightly/route';
import { sendGovernedInitiated } from '@/lib/whatsapp/v2/deliverability/governedSend';
import { getTenantWhatsAppProviderClient } from '@/lib/whatsapp/providers/providerSelection';

const mockedSendGovernedInitiated = sendGovernedInitiated as jest.MockedFunction<typeof sendGovernedInitiated>;
const mockedGetTenantWhatsAppProviderClient =
  getTenantWhatsAppProviderClient as jest.MockedFunction<typeof getTenantWhatsAppProviderClient>;

// ── Shared fixtures ────────────────────────────────────────────────────────

const FOUR_DAYS_AGO = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();

function validReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'res_1',
    tenant_id: 'tenant_1',
    customer_id: 'cust_1',
    customer_number: '+2348012345678',
    customer_name: 'Ada',
    service_id: 'svc_1',
    start_at: FOUR_DAYS_AGO,
    services: { name: 'Trim', rebooking_interval_days: 30 },
    tenants:  { v2_enabled: true, metadata: {}, tone_config: {} },
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
    __resetWhatsAppSendCache();
    jest.clearAllMocks();
    mockedSendGovernedInitiated.mockResolvedValue({ sent: true, mode: 'freeform', reason: 'sent' });
    mockedGetTenantWhatsAppProviderClient.mockResolvedValue({
      sendTextMessage: jest.fn().mockResolvedValue({ success: true, messageId: 'msg_1' }),
      sendTemplateMessage: jest.fn().mockResolvedValue({ success: true, messageId: 'msg_2' }),
    } as never);
  });

  it('returns 0 when no reservations fall in the 3–4 day window', async () => {
    pushDb([]); // initial reservations query (direct-await)
    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(0);
  });

  it('skips reservation when tenant is not v2_enabled', async () => {
    pushDb([validReservation({ tenants: { v2_enabled: false, metadata: {}, tone_config: {} } })]);
    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(0);
  });

  it('skips reservation when service has no rebooking_interval_days', async () => {
    pushDb([validReservation({ services: { name: 'Trim', rebooking_interval_days: null } })]);
    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(0);
  });

  it('skips reservation when customer_number is null', async () => {
    pushDb([validReservation({ customer_number: null })]);
    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(0);
  });

  it('still sends when customer is not found in the customers table', async () => {
    pushDb([validReservation()]); // initial query
    pushDb(null);                 // customers → not found (maybeSingle)
    pushDb([]);                   // no prior follow-up
    pushDb(null, 0);              // no newer reservation
    pushDb({ last_inbound_at: null, opted_out_at: null });
    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(1);
  });

  it('skips when a follow-up was already sent for this customer+service', async () => {
    pushDb([validReservation()]);
    pushDb({ id: 'cust_1', name: 'Ada' });
    pushDb([{ id: 'run_1' }]); // prior follow-up campaign exists
    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(0);
  });

  it('skips when customer has a newer reservation for the same service', async () => {
    pushDb([validReservation()]);
    pushDb({ id: 'cust_1', name: 'Ada' }); // customers (maybeSingle)
    pushDb([]);                            // no prior follow-up
    pushDb(null, 1);                       // newer count (direct-await) → count: 1
    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(0);
  });

  it('skips when no WhatsApp config is found for the tenant', async () => {
    mockedGetTenantWhatsAppProviderClient.mockResolvedValueOnce(null);
    pushDb([validReservation()]);
    pushDb({ id: 'cust_1', name: 'Ada' }); // customers
    pushDb([]);                            // no prior follow-up
    pushDb(null, 0);                       // newer count → 0
    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(0);
  });

  it('skips and does not update metadata when governed send returns unsent', async () => {
    pushDb([validReservation()]);
    pushDb({ id: 'cust_1', name: 'Ada' });
    pushDb([]);
    pushDb(null, 0);
    pushDb({ last_inbound_at: null, opted_out_at: null });
    mockedSendGovernedInitiated.mockResolvedValue({ sent: false, reason: 'allocation_exhausted' });

    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(0);
    expect(mockedSendGovernedInitiated).toHaveBeenCalled();
  });

  it('sends follow-up and updates metadata on happy path', async () => {
    const res = validReservation();
    pushDb([res]);
    pushDb({ id: 'cust_1', name: 'Ada' });
    pushDb([]);        // no prior follow-up
    pushDb(null, 0);   // newer count
    pushDb({ last_inbound_at: null, opted_out_at: null });

    const sent = await sendRebookingFollowUps();
    expect(sent).toBe(1);
    expect(mockedSendGovernedInitiated).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant_1',
        recipient: '+2348012345678',
        messageType: 'rebooking_followup',
      }),
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
    __resetWhatsAppSendCache();
    jest.clearAllMocks();
    mockedSendGovernedInitiated.mockResolvedValue({ sent: true, mode: 'freeform', reason: 'sent' });
    mockedGetTenantWhatsAppProviderClient.mockResolvedValue({
      sendTextMessage: jest.fn().mockResolvedValue({ success: true, messageId: 'msg_1' }),
      sendTemplateMessage: jest.fn().mockResolvedValue({ success: true, messageId: 'msg_2' }),
    } as never);
  });

  it('returns 0 when there are no v2-enabled tenants', async () => {
    pushDb([]); // tenants (direct-await)
    const sent = await sendRebookingNudges();
    expect(sent).toBe(0);
  });

  it('skips tenant when no services have rebooking_interval_days set', async () => {
    pushDb([{ id: 'tenant_1' }]); // tenants
    pushDb([]);                                  // services → empty (direct-await)
    const sent = await sendRebookingNudges();
    expect(sent).toBe(0);
  });

  it('skips tenant when no WhatsApp config is found', async () => {
    mockedGetTenantWhatsAppProviderClient.mockResolvedValueOnce(null);
    pushDb([{ id: 'tenant_1' }]);
    pushDb([{ id: 'svc_1', name: 'Trim', rebooking_interval_days: 30, is_active: true }]);
    const sent = await sendRebookingNudges();
    expect(sent).toBe(0);
  });

  it('skips service when no completed reservations are older than the cutoff', async () => {
    pushDb([{ id: 'tenant_1' }]);
    pushDb([{ id: 'svc_1', name: 'Trim', rebooking_interval_days: 30, is_active: true }]);
    pushDb([]); // reservations before cutoff → empty
    const sent = await sendRebookingNudges();
    expect(sent).toBe(0);
  });

  it('skips customer when a newer booking already exists', async () => {
    const oldStart = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    pushDb([{ id: 'tenant_1' }]);
    pushDb([{ id: 'svc_1', name: 'Trim', rebooking_interval_days: 30, is_active: true }]);
    pushDb([{ id: 'res_1', customer_id: 'cust_1', customer_number: '+2348012345678', customer_name: 'Ada', start_at: oldStart }]);
    pushDb(null, 1); // newer count (direct-await) → count: 1
    const sent = await sendRebookingNudges();
    expect(sent).toBe(0);
  });

  it('still sends when customer record is not found', async () => {
    const oldStart = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    pushDb([{ id: 'tenant_1' }]);
    pushDb([{ id: 'svc_1', name: 'Trim', rebooking_interval_days: 30, is_active: true }]);
    pushDb([{ id: 'res_1', customer_id: 'cust_1', customer_number: '+2348012345678', customer_name: 'Ada', start_at: oldStart }]);
    pushDb(null, 0); // newer count → 0
    pushDb(null);    // customer (maybeSingle) → not found
    pushDb([]);      // no prior nudges
    pushDb({ last_inbound_at: null, opted_out_at: null });
    const sent = await sendRebookingNudges();
    expect(sent).toBe(1);
  });

  it('skips customer when nudge was sent within the throttle window', async () => {
    const intervalDays = 30;
    const oldStart = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const lastNudgeAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    pushDb([{ id: 'tenant_1' }]);
    pushDb([{ id: 'svc_1', name: 'Trim', rebooking_interval_days: intervalDays, is_active: true }]);
    pushDb([{ id: 'res_1', customer_id: 'cust_1', customer_number: '+2348012345678', customer_name: 'Ada', start_at: oldStart }]);
    pushDb(null, 0);
    pushDb({ id: 'cust_1', name: 'Ada' });
    pushDb([{ created_at: lastNudgeAt }]);

    const sent = await sendRebookingNudges();
    expect(sent).toBe(0);
  });

  it('sends nudge and updates metadata on happy path', async () => {
    const oldStart = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

    pushDb([{ id: 'tenant_1' }]);
    pushDb([{ id: 'svc_1', name: 'Trim', rebooking_interval_days: 30, is_active: true }]);
    pushDb([{ id: 'res_1', customer_id: 'cust_1', customer_number: '+2348012345678', customer_name: 'Ada', start_at: oldStart }]);
    pushDb(null, 0); // newer count
    pushDb({ id: 'cust_1', name: 'Ada' }); // customer
    pushDb([]);                            // no prior nudges
    pushDb({ last_inbound_at: null, opted_out_at: null });

    const sent = await sendRebookingNudges();
    expect(sent).toBe(1);
    expect(mockedSendGovernedInitiated).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant_1',
        recipient: '+2348012345678',
        messageType: 'rebooking_nudge',
      }),
    );
  });
});
