import { enterOffboarding, reactivate } from '@/lib/offboarding/offboardService';
import { TEARDOWN_TASK_TYPES } from '@/lib/offboarding/types';

jest.mock('@/lib/audit/log', () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));

type Resp = { data: unknown; error: unknown };
type DbPayload = Record<string, unknown>;
type OffboardingUpdate = {
  lifecycle_state?: string;
  scheduled_purge_at?: string | null;
  financials_purge_at?: string | null;
  offboarding_reason?: string | null;
};
type QueuedTask = { task_type: string };
type MockChain = {
  select: () => MockChain;
  eq: () => MockChain;
  in: () => MockChain;
  single: () => Promise<Resp>;
  maybeSingle: () => Promise<Resp>;
  insert: (rows: DbPayload | DbPayload[]) => Promise<Resp>;
  update: (payload: OffboardingUpdate) => MockChain;
  then: PromiseLike<Resp>['then'];
};
const responses: Resp[] = [];
const updates: OffboardingUpdate[] = [];
const inserted: QueuedTask[] = [];
function pushDb(data: unknown) { responses.push({ data, error: null }); }
function consume(): Resp { return responses.shift() ?? { data: null, error: null }; }

function makeChain() {
  const chain = {} as MockChain;
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.in = jest.fn(() => chain);
  chain.single = jest.fn(() => Promise.resolve(consume()));
  chain.maybeSingle = jest.fn(() => Promise.resolve(consume()));
  chain.insert = jest.fn((rows: DbPayload | DbPayload[]) => {
    const queuedRows = Array.isArray(rows) ? rows : [rows];
    inserted.push(...queuedRows.filter((row): row is QueuedTask => typeof row.task_type === 'string'));
    return Promise.resolve({ data: null, error: null });
  });
  chain.update = jest.fn((payload: OffboardingUpdate) => { updates.push(payload); return chain; });
  chain.then = (onfulfilled, onrejected) => Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
  return chain;
}
const admin = { from: jest.fn(() => makeChain()) };

beforeEach(() => { responses.length = 0; updates.length = 0; inserted.length = 0; jest.clearAllMocks(); });

describe('enterOffboarding', () => {
  it('voluntary: scheduled_for_deletion with 30d grace + 7y financial deadline, queues all teardown tasks', async () => {
    pushDb({ id: 't1', name: 'Acme', lifecycle_state: 'active' });
    const res = await enterOffboarding(admin as unknown as Parameters<typeof enterOffboarding>[0], { tenantId: 't1', reason: 'voluntary', actorUserId: 'u1', actorRole: 'owner' });
    expect(res.lifecycleState).toBe('scheduled_for_deletion');
    expect(updates[0].lifecycle_state).toBe('scheduled_for_deletion');
    expect(updates[0].scheduled_purge_at).toEqual(expect.any(String));
    expect(updates[0].financials_purge_at).toEqual(expect.any(String));
    expect(inserted.map((r) => r.task_type).sort()).toEqual([...TEARDOWN_TASK_TYPES].sort());
  });

  it('gdpr_erasure: grace = 0 (scheduled_purge_at ~= now)', async () => {
    pushDb({ id: 't1', name: 'Acme', lifecycle_state: 'active' });
    await enterOffboarding(admin as unknown as Parameters<typeof enterOffboarding>[0], { tenantId: 't1', reason: 'gdpr_erasure', actorUserId: 's1', actorRole: 'superadmin' });
    const ms = Date.parse(updates[0].scheduled_purge_at) - Date.now();
    expect(Math.abs(ms)).toBeLessThan(5000);
  });

  it('rejects re-entry when not active', async () => {
    pushDb({ id: 't1', name: 'Acme', lifecycle_state: 'scheduled_for_deletion' });
    await expect(enterOffboarding(admin as unknown as Parameters<typeof enterOffboarding>[0], { tenantId: 't1', reason: 'voluntary', actorUserId: 'u1', actorRole: 'owner' }))
      .rejects.toThrow(/invalid lifecycle transition/i);
  });
});

describe('reactivate', () => {
  it('returns to active and clears purge timestamps within grace', async () => {
    pushDb({ id: 't1', lifecycle_state: 'scheduled_for_deletion' });
    await reactivate(admin as unknown as Parameters<typeof reactivate>[0], { tenantId: 't1', actorUserId: 'u1', actorRole: 'owner' });
    expect(updates[0]).toEqual(expect.objectContaining({
      lifecycle_state: 'active', scheduled_purge_at: null, financials_purge_at: null, offboarding_reason: null,
    }));
  });
  it('refuses to reactivate once purged', async () => {
    pushDb({ id: 't1', lifecycle_state: 'purged' });
    await expect(reactivate(admin as unknown as Parameters<typeof reactivate>[0], { tenantId: 't1', actorUserId: 'u1', actorRole: 'owner' }))
      .rejects.toThrow(/invalid lifecycle transition/i);
  });
});
