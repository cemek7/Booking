/**
 * Ops-Loop Smoke Test — Stage Continuity Guard
 *
 * Proves that each of the six operations-loop stages is individually invocable
 * and returns the expected hand-off shape with mocked I/O. This is NOT a full
 * integration test; it is one focused assertion (or a small handful) per stage.
 *
 * Covered:
 *   Stage 2 — Deposit init       (POST /api/payments/deposits)
 *   Stage 3 — Payment success    (handlePaymentSuccess in lib/payments/lifecycle)
 *   Stage 4 — Reminders          (POST /api/reminders/run)
 *   Stage 5 — No-show/auto-cancel (POST /api/jobs/auto-cancel-unconfirmed)
 *   Stage 6 — Rebooking           (sendRebookingFollowUps / sendRebookingNudges)
 *
 * Deferred (it.todo):
 *   Stage 1 — Inbound processMessageV2: heavy dependency tree
 *   (createClient at module level + 9+ deep imports from AI/WA/billing layers;
 *    cannot be mocked cleanly without modifying production code.)
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Global mocks (must be hoisted before any import of the modules under test)
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('@/lib/supabase/server', () => ({
  getSupabaseRouteHandlerClient: jest.fn(),
  // The nightly cron route captures its client at module load
  // (`const supabaseAdmin = createSupabaseAdminClient()`), so this must return a
  // usable client from the first call — a bare jest.fn() yields undefined and
  // the stage 6 rebooking helpers fail on `undefined.from`. Individual stages
  // still override this with mockReturnValue(makeAdminMock()) where they need
  // to assert on specific queries.
  createSupabaseAdminClient: jest.fn(() => makeNightlySupabaseMock()),
  createServerSupabaseClient: jest.fn(),
}));

jest.mock('@/lib/supabase/bearer-client', () => ({
  createSupabaseBearerClient: jest.fn(),
}));

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

// Stage 2 deps
jest.mock('@/lib/paymentService', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    initializePayment: jest.fn(async () => ({
      success: true,
      transactionId: 'txn_smoke',
      authorizationUrl: 'https://pay.example.com/redirect',
    })),
  })),
}));

// Stage 3 deps — dynamic imports used inside handlePaymentSuccess
jest.mock('@/lib/whatsapp/evolutionClient', () => ({
  getTenantWhatsAppConfig: jest.fn(async () => null), // no WA config → skip WA send
}));
jest.mock('@/lib/integrations/whatsapp-service', () => ({
  sendBookingConfirmationWhatsApp: jest.fn(async () => undefined),
}));
jest.mock('@/lib/integrations/email-service', () => ({
  sendBookingConfirmation: jest.fn(async () => undefined),
}));

// Stage 4 deps
jest.mock('@/lib/whatsapp/providers/providerSelection', () => ({
  getTenantWhatsAppProviderClient: jest.fn(async () => null),
}));
jest.mock('@/lib/sias-operations', () => ({
  siasOperations: {
    recordCampaignRun: jest.fn(async () => undefined),
  },
}));

// Stage 5 deps (same WA mock above is sufficient)

// Stage 6 deps — nightly cron uses createClient from @supabase/supabase-js directly
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => makeNightlySupabaseMock()),
}));
jest.mock('@/lib/monitoring/telegramAlert', () => ({
  sendTelegramInfo: jest.fn(async () => undefined),
  sendTelegramAlert: jest.fn(async () => undefined),
}));
jest.mock('@/lib/siasCampaignRunner', () => ({
  runDueSiasCampaigns: jest.fn(async () => ({ processed: 0, delivered: 0, failed: 0 })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Imports (after mocks)
// ─────────────────────────────────────────────────────────────────────────────

import { createSupabaseAdminClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { createSupabaseBearerClient } from '@/lib/supabase/bearer-client';
import { POST as depositPost } from '@/app/api/payments/deposits/route';
import { handlePaymentSuccess } from '@/lib/payments/lifecycle';
import { POST as remindersPost } from '@/app/api/reminders/run/route';
import { POST as autoCancelPost } from '@/app/api/jobs/auto-cancel-unconfirmed/route';
import {
  sendRebookingFollowUps,
  sendRebookingNudges,
} from '@/app/api/cron/nightly/route';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Chainable fluent builder used by admin + bearer mocks for route tests. */
function chainOf(final: unknown): Record<string, unknown> {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    not: () => chain,
    lte: () => chain,
    gt: () => chain,
    gte: () => chain,
    lt: () => chain,
    limit: () => chain,
    maybeSingle: async () => final,
    single: async () => final,
    then(resolve: (v: unknown) => unknown) { return resolve(final); },
  };
  return chain;
}

/** Admin mock — resolves auth.getUser and tenant_users membership. */
function makeAdminMock(role = 'owner') {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'usr_smoke', email: 'smoke@test.com' } },
        error: null,
      }),
    },
    from: jest.fn((table: string) => {
      if (table === 'tenant_users')
        return chainOf({ data: { tenant_id: 'ten_smoke', role }, error: null });
      return chainOf({ data: null, error: null });
    }),
  };
}

/** Bearer mock used by the handler body for route tests. */
function makeBearerMock(overrides: Record<string, unknown> = {}) {
  return {
    from: jest.fn((table: string) => {
      if (table === 'tenant_users')
        return chainOf({ data: { tenant_id: 'ten_smoke' }, error: null });
      if (table === 'reservations')
        return chainOf({ data: overrides.reservation ?? { id: 'res_smoke', status: 'pending' }, error: null });
      if (table === 'transactions')
        return chainOf({ data: overrides.transaction ?? null, error: null });
      if (table === 'tenants')
        return chainOf({ data: overrides.tenant ?? { metadata: {} }, error: null });
      if (table === 'reminders') {
        // update().eq(...).select() chain — returns rows
        return {
          update: () => ({
            eq: () => ({
              lte: () => ({
                eq: () => ({
                  limit: () => ({
                    select: jest.fn().mockResolvedValue({
                      data: overrides.reminders ?? [],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  lte: jest.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return chainOf({ data: null, error: null });
    }),
  };
}

/** Supabase mock for the route-handler client (auth:false cron routes). */
function makeCronSupabaseMock(opts: { bookings?: object[] } = {}) {
  const updateFn = jest.fn(() => ({
    eq: jest.fn().mockResolvedValue({ data: null, error: null }),
  }));

  const mock = {
    _updateFn: updateFn,
    from: jest.fn((table: string) => {
      if (table === 'tenants') {
        return {
          select: jest.fn().mockResolvedValue({
            data: [{ id: 'ten_smoke', name: 'Smoke Salon', settings: {} }],
            error: null,
          }),
        };
      }
      if (table === 'reservations') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              in: jest.fn(() => ({
                lte: jest.fn(() => ({
                  gt: jest.fn().mockResolvedValue({
                    data: opts.bookings ?? [],
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
        return { insert: jest.fn().mockResolvedValue({ data: null, error: null }) };
      }
      return { select: jest.fn().mockResolvedValue({ data: null, error: null }) };
    }),
  };
  return mock;
}

/** Supabase mock used by the nightly cron's module-level supabaseAdmin.
 *  Because createClient is mocked globally, this factory is called at import
 *  time. We return an object that handles all queries the cron fires. */
function makeNightlySupabaseMock() {
  const chain = (v: unknown): Record<string, unknown> => ({
    select: jest.fn(() => chain(v)),
    eq: jest.fn(() => chain(v)),
    not: jest.fn(() => chain(v)),
    in: jest.fn(() => chain(v)),
    lte: jest.fn(() => chain(v)),
    lt: jest.fn(() => chain(v)),
    gt: jest.fn(() => chain(v)),
    gte: jest.fn(() => chain(v)),
    limit: jest.fn(() => chain(v)),
    maybeSingle: jest.fn(async () => v),
    single: jest.fn(async () => v),
    upsert: jest.fn(async () => ({ error: null })),
    update: jest.fn(() => chain({ error: null })),
    then(resolve: (v: unknown) => unknown) { return resolve(v); },
  });

  return {
    from: jest.fn(() => chain({ data: [], error: null, count: 0 })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Smoke tests
// ─────────────────────────────────────────────────────────────────────────────

const CRON_SECRET = 'smoke-cron-secret';

describe('Ops-loop smoke test — stage continuity guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
    // Env vars required by some modules
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-test';
  });

  // ── Stage 1: Inbound (processMessageV2) ────────────────────────────────────
  it.todo(
    'stage 1: inbound — processMessageV2 deferred: module-level createClient + 9+ deep ' +
      'imports (Google AI, OpenRouter, billing wallet, whatsapp providers, ownerCommands, ' +
      'customerBooking) make clean mocking impractical without modifying production code'
  );

  // ── Stage 2: Deposit init ──────────────────────────────────────────────────
  describe('stage 2: deposit init — POST /api/payments/deposits', () => {
    function depositReq(body: unknown) {
      return new NextRequest('http://localhost:3000/api/payments/deposits', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer smoke-token',
          'x-tenant-id': 'ten_smoke',
        },
        body: JSON.stringify(body),
      });
    }

    beforeEach(() => {
      (createSupabaseAdminClient as jest.Mock).mockReturnValue(makeAdminMock());
      (createSupabaseBearerClient as jest.Mock).mockReturnValue(makeBearerMock());
    });

    it('returns authorizationUrl and transactionId for a valid deposit request', async () => {
      const res = await depositPost(depositReq({
        amount: 5000,
        email: 'customer@test.com',
        reservationId: 'res_smoke',
      }) as unknown as NextRequest);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        success: true,
        transactionId: 'txn_smoke',
        authorizationUrl: expect.stringContaining('https://'),
      });
    });

    it('rejects a deposit for a cancelled reservation (4xx)', async () => {
      (createSupabaseBearerClient as jest.Mock).mockReturnValue(
        makeBearerMock({ reservation: { id: 'res_smoke', status: 'cancelled' } }),
      );

      const res = await depositPost(depositReq({
        amount: 5000,
        email: 'customer@test.com',
        reservationId: 'res_smoke',
      }) as unknown as NextRequest);

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ── Stage 3: Payment success / confirm ────────────────────────────────────
  describe('stage 3: payment success — handlePaymentSuccess(input)', () => {
    /**
     * handlePaymentSuccess calls createServerSupabaseClient() at execution time.
     * We provide a mock that:
     *   - returns null for the transactions lookup (no booking ID in tx) — exercises
     *     the "resolve reservation from reference" branch
     *   - returns null for maybeSingle → function returns early after the warn
     */
    function makeLifecycleMock() {
      const chain = (v: unknown): Record<string, unknown> => ({
        select: jest.fn(() => chain(v)),
        eq: jest.fn(() => chain(v)),
        not: jest.fn(() => chain(v)),
        update: jest.fn(() => chain(v)),
        maybeSingle: jest.fn(async () => ({ data: null, error: null })),
        single: jest.fn(async () => ({ data: null, error: null })),
      });

      return {
        from: jest.fn(() => chain(null)),
      };
    }

    it('resolves without throwing when no reservation is found for the reference', async () => {
      (createServerSupabaseClient as jest.Mock).mockReturnValue(makeLifecycleMock());

      // Should resolve (not throw) — the function logs a warning and returns early
      await expect(
        handlePaymentSuccess({
          tenantId: 'ten_smoke',
          reference: 'ref_smoke_001',
          provider: 'paystack',
        }),
      ).resolves.toBeUndefined();
    });

    it('confirms a reservation when reservationId is provided directly', async () => {
      // Provide a full mock that returns a reservation row
      const updateFn = jest.fn(() => ({
        eq: jest.fn(() => ({
          eq: jest.fn(() => ({
            not: jest.fn(() => ({
              select: jest.fn(() => ({
                maybeSingle: jest.fn(async () => ({
                  data: {
                    id: 'res_smoke',
                    start_at: new Date(Date.now() + 3_600_000).toISOString(),
                    end_at: null,
                    customer_name: 'Jane Smoke',
                    customer_phone: null, // no phone → skip WA
                    customer_email: null, // no email → skip email
                    notes: null,
                    service_id: 'svc_smoke',
                  },
                  error: null,
                })),
              })),
            })),
          })),
        })),
      }));

      const txUpdateFn = jest.fn(() => ({
        eq: jest.fn(() => ({
          eq: jest.fn().mockResolvedValue({ data: null, error: null }),
        })),
      }));

      const lifecycleMock = {
        from: jest.fn((table: string) => {
          if (table === 'reservations') return { update: updateFn };
          if (table === 'transactions') return { update: txUpdateFn };
          // services + tenants
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                maybeSingle: jest.fn(async () => ({ data: null, error: null })),
              })),
            })),
          };
        }),
      };

      (createServerSupabaseClient as jest.Mock).mockReturnValue(lifecycleMock);

      await expect(
        handlePaymentSuccess({
          tenantId: 'ten_smoke',
          reference: 'ref_smoke_002',
          provider: 'paystack',
          reservationId: 'res_smoke',
        }),
      ).resolves.toBeUndefined();

      // The reservation update must have been attempted with status: 'confirmed'
      // (handlePaymentSuccess writes { status: 'confirmed', updated_at: ... })
      expect(updateFn).toHaveBeenCalledTimes(1);
      expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }));
    });
  });

  // ── Stage 4: Reminders ────────────────────────────────────────────────────
  describe('stage 4: reminders — POST /api/reminders/run', () => {
    function remindersReq() {
      return new NextRequest('http://localhost:3000/api/reminders/run', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer smoke-token',
          'x-tenant-id': 'ten_smoke',
        },
        body: JSON.stringify({}),
      });
    }

    beforeEach(() => {
      (createSupabaseAdminClient as jest.Mock).mockReturnValue(makeAdminMock());
    });

    it('returns { processed: 0 } when there are no pending reminders', async () => {
      // Bearer mock provides an empty reminders query
      (createSupabaseBearerClient as jest.Mock).mockReturnValue(makeBearerMock({ reminders: [] }));

      const res = await remindersPost(remindersReq() as unknown as NextRequest);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ processed: 0 });
    });
  });

  // ── Stage 5: No-show / auto-cancel ───────────────────────────────────────
  describe('stage 5: no-show / auto-cancel — POST /api/jobs/auto-cancel-unconfirmed', () => {
    function cronReq(secret?: string) {
      return new NextRequest('http://localhost:3000/api/jobs/auto-cancel-unconfirmed', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cron-secret': secret ?? CRON_SECRET,
        },
      });
    }

    const staleReservation = {
      id: 'res_stale_smoke',
      tenant_id: 'ten_smoke',
      phone: '+2341234567890',
      customer_name: 'Smoke Customer',
      service: 'Hair Cut',
      start_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };

    it('cancels a stale unconfirmed reservation and returns { processed: 1, cancelled: 1 }', async () => {
      const { getSupabaseRouteHandlerClient } = await import('@/lib/supabase/server');
      const sb = makeCronSupabaseMock({ bookings: [staleReservation] });
      (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(sb);

      const res = await autoCancelPost(cronReq() as unknown as NextRequest);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toMatchObject({
        success: true,
        results: { processed: 1, cancelled: 1 },
      });
    });

    it('rejects requests with a wrong cron secret (4xx)', async () => {
      const { getSupabaseRouteHandlerClient } = await import('@/lib/supabase/server');
      (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(
        makeCronSupabaseMock({ bookings: [] }),
      );

      const res = await autoCancelPost(cronReq('wrong-secret') as unknown as NextRequest);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ── Stage 6: Rebooking ────────────────────────────────────────────────────
  describe('stage 6: rebooking — sendRebookingFollowUps / sendRebookingNudges', () => {
    it('sendRebookingFollowUps returns 0 when no completed reservations exist', async () => {
      // The nightly cron uses a module-level supabaseAdmin (createClient mock above)
      // which returns empty arrays for all queries — no reservations → 0 sent.
      const sent = await sendRebookingFollowUps();
      expect(typeof sent).toBe('number');
      expect(sent).toBe(0);
    });

    it('sendRebookingNudges returns 0 when no v2-enabled tenants exist', async () => {
      const sent = await sendRebookingNudges();
      expect(typeof sent).toBe('number');
      expect(sent).toBe(0);
    });
  });
});
