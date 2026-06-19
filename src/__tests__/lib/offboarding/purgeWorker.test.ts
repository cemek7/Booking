import { runDueTeardownTasks, runOperationalPurge, runFinancialPurge } from '@/lib/offboarding/purgeWorker';

jest.mock('@/lib/offboarding/teardownTasks', () => ({ runTeardownTask: jest.fn().mockResolvedValue({ status: 'done' }) }));
jest.mock('@/lib/audit/log', () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));

type Resp = { data: unknown; error: unknown };
const responses: Resp[] = [];
const deletes: string[] = [];
const updates: any[] = [];
function pushDb(data: unknown) { responses.push({ data, error: null }); }
function consume(): Resp { return responses.shift() ?? { data: null, error: null }; }

function makeChain(table: string) {
  const chain: any = { _isDelete: false, _isSelect: false };
  chain.select = jest.fn(() => { chain._isSelect = true; return chain; });
  chain.delete = jest.fn(() => { chain._isDelete = true; return chain; });
  chain.update = jest.fn((p: any) => { updates.push(p); return chain; });
  ['eq', 'in', 'lt', 'lte'].forEach((m) => { chain[m] = jest.fn(() => chain); });
  chain.then = (f: any, r: any) => {
    let result: Resp;
    if (chain._isDelete) { deletes.push(table); result = { data: null, error: null }; }
    else if (chain._isSelect) { result = consume(); }
    else { result = { data: null, error: null }; }
    return Promise.resolve(result).then(f, r);
  };
  return chain;
}
const admin: any = { from: jest.fn((t: string) => makeChain(t)) };

beforeEach(() => { responses.length = 0; deletes.length = 0; updates.length = 0; jest.clearAllMocks(); });

describe('runOperationalPurge', () => {
  it('does NOT purge when gating tasks are still pending', async () => {
    pushDb([{ id: 't1', scheduled_purge_at: new Date(Date.now() - 1000).toISOString() }]);
    pushDb([{ task_type: 'revoke_whatsapp', status: 'pending' }]);
    const n = await runOperationalPurge(admin);
    expect(n).toBe(0);
    expect(deletes).toHaveLength(0);
  });

  it('purges operational tables and flips to purged when due + tasks done, keeping tenants + transactions', async () => {
    pushDb([{ id: 't1', scheduled_purge_at: new Date(Date.now() - 1000).toISOString() }]);
    pushDb([{ task_type: 'revoke_whatsapp', status: 'done' }, { task_type: 'export_data', status: 'done' }]);
    const n = await runOperationalPurge(admin);
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
});

describe('runFinancialPurge', () => {
  it('deletes transactions + offboarding_tasks + the tenants row past retention', async () => {
    pushDb([{ id: 't1' }]);
    const n = await runFinancialPurge(admin);
    expect(n).toBe(1);
    expect(deletes).toEqual(expect.arrayContaining(['transactions', 'offboarding_tasks', 'tenants']));
  });
});
