/**
 * Regression test: abandoned-deposit / unconfirmed reservation → auto-cancel sweep
 *
 * Route: POST /api/jobs/auto-cancel-unconfirmed  (auth: false, cron-secret header)
 *
 * Discovered behaviour (Step 1):
 *  - Sweeps statuses:  'pending' | 'pending_approval' | 'unconfirmed'
 *  - Filter window:    start_at <= now + hoursBefore  AND  start_at > now
 *  - Cancels via:      reservations.update({ status: 'cancelled', cancellation_reason, cancelled_at })
 *  - Also inserts:     reservation_logs  (best-effort, not asserted here)
 *  - Notify:          getTenantWhatsAppProviderClient (dynamic import, best-effort)
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ─── Mock Supabase (auth:false path uses getSupabaseRouteHandlerClient) ────────
jest.mock('@/lib/supabase/server', () => ({
  getSupabaseRouteHandlerClient: jest.fn(),
  createSupabaseAdminClient: jest.fn(),
  createServerSupabaseClient: jest.fn(),
}));

// ─── Mock monitoring / logger (imported by route-handler wrapper) ──────────────
jest.mock('@/lib/monitoring/alerting', () => ({
  getAlertService: jest.fn(() => ({
    sendErrorAlert: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('@/lib/logger/api-logger', () => ({
  createApiLogger: jest.fn(() => ({
    logRequest: jest.fn(),
    logError: jest.fn(),
    warn: jest.fn(),
  })),
}));

// ─── Mock WhatsApp provider (dynamic import inside notifyCustomerCancellation) ──
jest.mock('@/lib/whatsapp/providers/providerSelection', () => ({
  getTenantWhatsAppProviderClient: jest.fn(async () => null),
}));

import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { POST } from '@/app/api/jobs/auto-cancel-unconfirmed/route';

// ─── Constants ────────────────────────────────────────────────────────────────
const CRON_SECRET = 'test-cron-secret-xyz';

// A stale reservation that qualifies for auto-cancel.
// start_at is 1 hour from now (within the default 2-hour window).
const staleReservation = {
  id: 'res_stale_1',
  tenant_id: 'ten_1',
  phone: '+2348012345678',
  customer_name: 'Jane Doe',
  service: 'Hair Cut',
  start_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
};

// ─── Supabase mock factory ────────────────────────────────────────────────────
/**
 * Builds a chainable Supabase mock.
 *
 * The route issues these queries in order:
 *   1. from('tenants').select(...)                              → tenants array
 *   2. from('reservations').select(...).eq().in().lte().gt()   → bookings array
 *   3. from('reservations').update({...}).eq('id', booking.id) → cancel update
 *   4. from('reservation_logs').insert({...})                  → audit log
 *
 * `updateFn` is a jest.fn() so we can spy on the arguments passed to `.update()`.
 */
function makeSupabase(opts: {
  bookings?: object[];
  updateError?: { message: string } | null;
} = {}) {
  const updateFn = jest.fn(() => ({
    eq: jest.fn().mockResolvedValue({ data: null, error: opts.updateError ?? null }),
  }));

  const mock = {
    _updateFn: updateFn, // exposed so tests can assert on it
    from: jest.fn((table: string) => {
      if (table === 'tenants') {
        return {
          select: jest.fn().mockResolvedValue({
            data: [{ id: 'ten_1', name: 'Test Salon', settings: {} }],
            error: null,
          }),
        };
      }

      if (table === 'reservations') {
        // The route calls .select().eq().in().lte().gt() for the sweep query,
        // and .update({}).eq() for the cancel operation.
        // We return a chainable builder that differentiates on which method was
        // called first (select vs update).
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              in: jest.fn(() => ({
                lte: jest.fn(() => ({
                  gt: jest.fn().mockResolvedValue({
                    data: opts.bookings ?? [staleReservation],
                    error: null,
                  }),
                })),
              })),
            })),
          })),
          update: updateFn,
        };
      }

      if (table === 'reservation_logs') {
        return {
          insert: jest.fn().mockResolvedValue({ data: null, error: null }),
        };
      }

      return { select: jest.fn().mockResolvedValue({ data: null, error: null }) };
    }),
  };

  return mock;
}

// ─── Request factory ──────────────────────────────────────────────────────────
function cronRequest(overrideSecret?: string) {
  return new NextRequest('http://localhost:3000/api/jobs/auto-cancel-unconfirmed', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-cron-secret': overrideSecret ?? CRON_SECRET,
    },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('auto-cancel-unconfirmed job (auth:false, cron-secret)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
  });

  // ── Security gate ──────────────────────────────────────────────────────────
  it('rejects a request with a missing cron secret (4xx)', async () => {
    const sb = makeSupabase();
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(sb);

    const res = await POST(
      new NextRequest('http://localhost:3000/api/jobs/auto-cancel-unconfirmed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' }, // no x-cron-secret
      }) as unknown as NextRequest,
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects a request with an incorrect cron secret (4xx)', async () => {
    const sb = makeSupabase();
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(sb);

    const res = await POST(cronRequest('wrong-secret') as unknown as NextRequest);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  // ── Happy path: stale reservation is swept to `cancelled` ─────────────────
  it('transitions a stale unconfirmed reservation to `cancelled` (200)', async () => {
    const sb = makeSupabase({ bookings: [staleReservation] });
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(sb);

    const res = await POST(cronRequest() as unknown as NextRequest);

    // Response must be 200
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      results: {
        processed: 1,
        cancelled: 1,
      },
    });
  });

  it('calls reservations.update with status `cancelled` for the stale booking', async () => {
    const sb = makeSupabase({ bookings: [staleReservation] });
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(sb);

    await POST(cronRequest() as unknown as NextRequest);

    // The update fn must have been called once
    expect(sb._updateFn).toHaveBeenCalledTimes(1);

    // The first argument must contain `status: 'cancelled'`
    const updateArg = (sb._updateFn as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg).toMatchObject({
      status: 'cancelled',
      cancellation_reason: expect.stringContaining('Auto-cancelled'),
    });
    expect(updateArg).toHaveProperty('cancelled_at');
  });

  it('sweeps reservations with status in [pending, pending_approval, unconfirmed]', async () => {
    // One reservation per source status
    const multi = ['pending', 'pending_approval', 'unconfirmed'].map((st, i) => ({
      ...staleReservation,
      id: `res_${i}`,
      // phone null → no WA notification attempt
      phone: null,
      // keep start_at inside the 2-hour window
    }));

    const sb = makeSupabase({ bookings: multi });
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(sb);

    const res = await POST(cronRequest() as unknown as NextRequest);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.processed).toBe(3);
    expect(body.results.cancelled).toBe(3);
    // update must have been called once per booking
    expect(sb._updateFn).toHaveBeenCalledTimes(3);
  });

  // ── No-op when tenant has auto-cancel disabled ────────────────────────────
  it('skips a tenant with autoCancelUnconfirmedEnabled: false', async () => {
    const sb = makeSupabase();
    // Override tenants query to return a disabled tenant
    (sb.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'tenants') {
        return {
          select: jest.fn().mockResolvedValue({
            data: [
              { id: 'ten_disabled', name: 'Closed Salon', settings: { autoCancelUnconfirmedEnabled: false } },
            ],
            error: null,
          }),
        };
      }
      // reservations should never be queried for a disabled tenant
      return {
        select: jest.fn(() => { throw new Error('reservations must not be queried for disabled tenant'); }),
        update: jest.fn(),
      };
    });
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(sb);

    const res = await POST(cronRequest() as unknown as NextRequest);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.processed).toBe(0);
    expect(body.results.cancelled).toBe(0);
  });

  // ── Empty sweep ────────────────────────────────────────────────────────────
  it('returns success with 0 processed when no stale bookings exist', async () => {
    const sb = makeSupabase({ bookings: [] });
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(sb);

    const res = await POST(cronRequest() as unknown as NextRequest);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.processed).toBe(0);
    expect(body.results.cancelled).toBe(0);
    expect(sb._updateFn).not.toHaveBeenCalled();
  });

  // ── Update failure is recorded in errors, not thrown ─────────────────────
  it('records an update failure in results.errors without crashing', async () => {
    const sb = makeSupabase({ updateError: { message: 'DB constraint violation' } });
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(sb);

    const res = await POST(cronRequest() as unknown as NextRequest);

    expect(res.status).toBe(200);
    const body = await res.json();
    // Processed increments before the update; cancelled should remain 0
    expect(body.results.processed).toBe(1);
    expect(body.results.cancelled).toBe(0);
    expect(body.results.errors).toHaveLength(1);
    expect(body.results.errors[0]).toContain('DB constraint violation');
  });
});
