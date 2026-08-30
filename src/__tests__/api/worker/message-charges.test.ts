import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const releaseStaleReservations = jest.fn() as jest.Mock<() => Promise<{ released: number }>>;
const findStrandedReservations = jest.fn() as jest.Mock<() => Promise<unknown[]>>;
jest.mock('@/lib/billing/messageWallet', () => ({ releaseStaleReservations }));
jest.mock('@/lib/billing/messageReconciliation', () => ({ findStrandedReservations }));
jest.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => ({}) }));

import { GET } from '@/app/api/worker/message-charges/route';

// A minimal stub rather than `new Request(url, { headers })`: this project's
// test environment ships a Request whose constructor silently DROPS the headers
// init, so `headers.get('authorization')` is always null. A test built on that
// would pass its "rejects a wrong token" case for the wrong reason — no token
// is not a wrong token — and could never exercise the accept branch at all.
// The route only ever calls request.headers.get, so this stub exercises the
// real code path honestly.
function req(auth?: string): Request {
  return {
    headers: { get: (name: string) => (name.toLowerCase() === 'authorization' ? auth ?? null : null) },
  } as unknown as Request;
}

describe('GET /api/worker/message-charges', () => {
  // NODE_ENV is typed readonly, so assign through the index signature.
  const setNodeEnv = (v: string) => { (process.env as Record<string, string>).NODE_ENV = v; };

  beforeEach(() => {
    jest.clearAllMocks();
    setNodeEnv('test');
    delete process.env.CRON_SECRET;
    findStrandedReservations.mockResolvedValue([]);
  });

  it('releases stale reservations', async () => {
    releaseStaleReservations.mockResolvedValue({ released: 3 });
    const res = await GET(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ released: 3, stranded: 0 });
  });

  it('reports stranded reservations the sweep structurally cannot see', async () => {
    // The sweep filters wamid IS NOT NULL, so reserved rows with a NULL wamid
    // are invisible to every automatic path. This is their only alarm.
    releaseStaleReservations.mockResolvedValue({ released: 0 });
    findStrandedReservations.mockResolvedValue([{ chargeId: 'chg-1' }, { chargeId: 'chg-2' }]);
    const res = await GET(req());
    await expect(res.json()).resolves.toEqual({ released: 0, stranded: 2 });
  });

  it('rejects unauthorised calls in production', async () => {
    setNodeEnv('production');
    process.env.CRON_SECRET = 'secret';
    const res = await GET(req('Bearer wrong'));
    expect(res.status).toBe(401);
    expect(releaseStaleReservations).not.toHaveBeenCalled();
  });

  it('rejects in production when no CRON_SECRET is configured at all', async () => {
    // Otherwise a deploy that forgot the secret would expose an unauthenticated
    // endpoint that moves money, rather than failing closed.
    setNodeEnv('production');
    const res = await GET(req('Bearer anything'));
    expect(res.status).toBe(401);
  });

  it('accepts the correct bearer token in production', async () => {
    setNodeEnv('production');
    process.env.CRON_SECRET = 'secret';
    releaseStaleReservations.mockResolvedValue({ released: 0 });
    const res = await GET(req('Bearer secret'));
    expect(res.status).toBe(200);
  });

  it('returns 500 rather than throwing when the sweep fails', async () => {
    releaseStaleReservations.mockRejectedValue(new Error('db down'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
