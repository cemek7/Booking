/**
 * Tests for GET /api/cron/reminders — the all-tenants scheduled reminder driver.
 *
 * Strategy: mock runRemindersForTenant (its own logic is exercised elsewhere) and stub the
 * tenant-list query, so these tests focus on auth, fan-out, aggregation, and failure isolation.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mutable holder for the `from('tenants').select('id').is('offboarded_at', null)` result.
// Must be `mock`-prefixed to be referenceable inside the hoisted jest.mock factory.
const mockTenantsResponse: { data: unknown; error: unknown } = { data: [], error: null };

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        is: () => Promise.resolve(mockTenantsResponse),
      }),
    }),
  }),
}));

// The route builds its client with createSupabaseAdminClient() from
// @/lib/supabase/server. Mocking only @supabase/supabase-js left the real
// client in place, so the tenant list came back empty and the runner never ran.
jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({
        is: () => Promise.resolve(mockTenantsResponse),
      }),
    }),
  }),
}));

jest.mock('@/lib/reminders/runner', () => ({
  runRemindersForTenant: jest.fn(),
}));

import { runRemindersForTenant } from '@/lib/reminders/runner';
import { GET } from '@/app/api/cron/reminders/route';

const mockRunner = runRemindersForTenant as jest.MockedFunction<typeof runRemindersForTenant>;

// Minimal request stub — the route only reads request.headers.get('authorization').
// Avoids environment-specific Request/Headers construction quirks under jest.
function req(auth?: string): Request {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'authorization' ? auth ?? null : null,
    },
  } as unknown as Request;
}

describe('GET /api/cron/reminders', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;
  const ORIGINAL_SECRET = process.env.CRON_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTenantsResponse.data = [];
    mockTenantsResponse.error = null;
    process.env.NODE_ENV = ORIGINAL_ENV;
    process.env.CRON_SECRET = ORIGINAL_SECRET;
  });

  it('returns 401 in production when the Bearer secret is missing/wrong', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CRON_SECRET = 'right-secret';

    const res = await GET(req('Bearer wrong-secret'));

    expect(res.status).toBe(401);
    expect(mockRunner).not.toHaveBeenCalled();
  });

  it('authorizes in production with the correct Bearer secret', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CRON_SECRET = 'right-secret';
    mockTenantsResponse.data = [{ id: 't1' }];
    mockRunner.mockResolvedValue({ processed: 0, v2_reminders_sent: 0 });

    const res = await GET(req('Bearer right-secret'));

    expect(res.status).toBe(200);
    expect(mockRunner).toHaveBeenCalledWith(expect.anything(), 't1');
  });

  it('fans out to every tenant and aggregates the totals', async () => {
    mockTenantsResponse.data = [{ id: 't1' }, { id: 't2' }];
    mockRunner
      .mockResolvedValueOnce({ processed: 2, v2_reminders_sent: 1 })
      .mockResolvedValueOnce({ processed: 3, v2_reminders_sent: 0 });

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockRunner).toHaveBeenCalledTimes(2);
    expect(body.tenants_processed).toBe(2);
    expect(body.reminders_processed).toBe(5);
    expect(body.v2_reminders_sent).toBe(1);
    expect(body.failures).toEqual([]);
  });

  it('isolates a per-tenant failure and still processes the others', async () => {
    mockTenantsResponse.data = [{ id: 't1' }, { id: 't2' }];
    mockRunner
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ processed: 4, v2_reminders_sent: 2 });

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tenants_processed).toBe(1);
    expect(body.reminders_processed).toBe(4);
    expect(body.v2_reminders_sent).toBe(2);
    expect(body.failures).toEqual([{ tenantId: 't1', error: 'boom' }]);
  });

  it('returns 500 when the tenant list query fails', async () => {
    mockTenantsResponse.error = { message: 'db down' };

    const res = await GET(req());

    expect(res.status).toBe(500);
    expect(mockRunner).not.toHaveBeenCalled();
  });
});
