import { runOperationalPurge, runFinancialPurge } from '@/lib/offboarding/purgeWorker';

jest.mock('@/lib/offboarding/teardownTasks', () => ({ runTeardownTask: jest.fn().mockResolvedValue({ status: 'done' }) }));
jest.mock('@/lib/audit/log', () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));

type Resp = { data: unknown; error: unknown };
type OffboardingUpdate = { lifecycle_state?: string };
type FluentMethod = (...args: unknown[]) => PurgeChain;
type PurgeChain = {
  _isDelete: boolean;
  _isSelect: boolean;
  select: FluentMethod;
  delete: FluentMethod;
  update: (payload: OffboardingUpdate) => PurgeChain;
  eq: FluentMethod;
  in: FluentMethod;
  lt: FluentMethod;
  lte: FluentMethod;
  then: PromiseLike<Resp>['then'];
};
type PurgeClient = { from: (table: string) => PurgeChain };
const responses: Resp[] = [];
const deletes: string[] = [];
const updates: OffboardingUpdate[] = [];
function pushDb(data: unknown) { responses.push({ data, error: null }); }
function consume(): Resp { return responses.shift() ?? { data: null, error: null }; }

function makeChain(table: string) {
  const chain = { _isDelete: false, _isSelect: false } as PurgeChain;
  chain.select = jest.fn(() => { chain._isSelect = true; return chain; });
  chain.delete = jest.fn(() => { chain._isDelete = true; return chain; });
  chain.update = jest.fn((payload: OffboardingUpdate) => { updates.push(payload); return chain; });
  const methods: Array<keyof Pick<PurgeChain, 'eq' | 'in' | 'lt' | 'lte'>> = ['eq', 'in', 'lt', 'lte'];
  methods.forEach((method) => { chain[method] = jest.fn(() => chain); });
  chain.then = (onfulfilled, onrejected) => {
    let result: Resp;
    if (chain._isDelete) { deletes.push(table); result = { data: null, error: null }; }
    else if (chain._isSelect) { result = consume(); }
    else { result = { data: null, error: null }; }
    return Promise.resolve(result).then(onfulfilled, onrejected);
  };
  return chain;
}
const admin: PurgeClient = { from: jest.fn((table: string) => makeChain(table)) };

beforeEach(() => { responses.length = 0; deletes.length = 0; updates.length = 0; jest.clearAllMocks(); });

describe('runOperationalPurge', () => {
  it('does NOT purge when gating tasks are still pending', async () => {
    pushDb([{ id: 't1', scheduled_purge_at: new Date(Date.now() - 1000).toISOString() }]);
    pushDb([{ task_type: 'revoke_whatsapp', status: 'pending' }]);
    const n = await runOperationalPurge(admin as unknown as Parameters<typeof runOperationalPurge>[0]);
    expect(n).toBe(0);
    expect(deletes).toHaveLength(0);
  });

  it('purges operational tables and flips to purged when due + tasks done, keeping tenants + transactions', async () => {
    pushDb([{ id: 't1', scheduled_purge_at: new Date(Date.now() - 1000).toISOString() }]);
    pushDb([{ task_type: 'revoke_whatsapp', status: 'done' }, { task_type: 'export_data', status: 'done' }]);
    const n = await runOperationalPurge(admin as unknown as Parameters<typeof runOperationalPurge>[0]);
    expect(n).toBe(1);
    expect(deletes).toEqual(expect.arrayContaining([
      'customers', 'reservations', 'messages', 'chats', 'services',
      'faqs', 'reviews', 'staff_schedules',
    ]));
    expect(deletes).not.toContain('transactions');
    expect(deletes).not.toContain('tenants');
    expect(deletes).not.toContain('audit_logs');
    expect(updates.at(-1)).toEqual(expect.objectContaining({ lifecycle_state: 'purged' }));
  });

  it('purges support_messages + support_assignments by ticket_id (no tenant_id of their own)', async () => {
    pushDb([{ id: 't1', scheduled_purge_at: new Date(Date.now() - 1000).toISOString() }]); // due tenants
    pushDb([{ task_type: 'export_data', status: 'done' }]);                                  // gating tasks
    pushDb([{ id: 'tk1' }, { id: 'tk2' }]);                                                   // support_tickets ids
    const n = await runOperationalPurge(admin as unknown as Parameters<typeof runOperationalPurge>[0]);
    expect(n).toBe(1);
    expect(deletes).toEqual(expect.arrayContaining(['support_messages', 'support_assignments', 'support_tickets']));
  });
});

describe('runFinancialPurge', () => {
  it('deletes transactions + offboarding_tasks + the tenants row past retention', async () => {
    pushDb([{ id: 't1' }]);
    const n = await runFinancialPurge(admin as unknown as Parameters<typeof runFinancialPurge>[0]);
    expect(n).toBe(1);
    expect(deletes).toEqual(expect.arrayContaining(['transactions', 'offboarding_tasks', 'tenants']));
  });
});
