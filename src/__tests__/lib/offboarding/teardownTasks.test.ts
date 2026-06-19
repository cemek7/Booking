import { runTeardownTask } from '@/lib/offboarding/teardownTasks';

jest.mock('@/lib/offboarding/exporter', () => ({ generateTenantExport: jest.fn().mockResolvedValue({ url: 'https://x/export.zip' }) }));
jest.mock('@/lib/whatsapp/providerSecrets', () => ({ getStoredProviderApiKey: jest.fn().mockResolvedValue('key') }));

type Resp = { data: unknown; error: unknown };
const responses: Resp[] = [];
const updates: any[] = [];
function pushDb(data: unknown) { responses.push({ data, error: null }); }
function consume(): Resp { return responses.shift() ?? { data: null, error: null }; }

function makeChain() {
  const chain: any = {};
  ['select', 'eq', 'delete'].forEach((m) => { chain[m] = jest.fn(() => chain); });
  chain.maybeSingle = jest.fn(() => Promise.resolve(consume()));
  chain.update = jest.fn((payload: any) => { updates.push(payload); return chain; });
  chain.then = (f: any, r: any) => Promise.resolve({ data: null, error: null }).then(f, r);
  return chain;
}
const admin: any = { from: jest.fn(() => makeChain()) };
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

beforeEach(() => { responses.length = 0; updates.length = 0; mockFetch.mockReset(); jest.clearAllMocks(); });

describe('runTeardownTask', () => {
  it('revoke_whatsapp deletes the Evolution instance and marks done', async () => {
    pushDb({ provider: 'evolution', instance_name: 'inst1', provider_base_url: 'https://wa', provider_api_key: 'k' });
    mockFetch.mockResolvedValue({ ok: true });
    const res = await runTeardownTask(admin, { id: 'x', tenant_id: 't1', task_type: 'revoke_whatsapp', attempts: 0, max_attempts: 5 } as any);
    expect(res.status).toBe('done');
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/instance/delete/inst1'), expect.objectContaining({ method: 'DELETE' }));
  });

  it('revoke_whatsapp with no config is a no-op -> skipped', async () => {
    pushDb(null);
    const res = await runTeardownTask(admin, { id: 'x', tenant_id: 't1', task_type: 'revoke_whatsapp', attempts: 0, max_attempts: 5 } as any);
    expect(res.status).toBe('skipped');
  });

  it('export_data calls the exporter and stores the url in payload -> done', async () => {
    const res = await runTeardownTask(admin, { id: 'x', tenant_id: 't1', task_type: 'export_data', attempts: 0, max_attempts: 5 } as any);
    expect(res.status).toBe('done');
    expect(res.payload).toEqual(expect.objectContaining({ export_url: 'https://x/export.zip' }));
  });

  it('marks failed when a provider call throws under max_attempts', async () => {
    pushDb({ provider: 'evolution', instance_name: 'inst1', provider_base_url: 'https://wa', provider_api_key: 'k' });
    mockFetch.mockRejectedValue(new Error('network'));
    const res = await runTeardownTask(admin, { id: 'x', tenant_id: 't1', task_type: 'revoke_whatsapp', attempts: 0, max_attempts: 5 } as any);
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/network/);
  });
});
