import { runTeardownTask, type OffboardingTaskRow } from '@/lib/offboarding/teardownTasks';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/offboarding/exporter', () => ({ generateTenantExport: jest.fn().mockResolvedValue({ url: 'https://x/export.zip' }) }));
jest.mock('@/lib/whatsapp/providerSecrets', () => ({ getStoredProviderApiKey: jest.fn().mockResolvedValue('key') }));

type Resp = { data: unknown; error: unknown };
const responses: Resp[] = [];
const updates: unknown[] = [];
function pushDb(data: unknown) { responses.push({ data, error: null }); }
function consume(): Resp { return responses.shift() ?? { data: null, error: null }; }

function makeChain() {
  const chain: Record<string, unknown> = {};
  ['select', 'eq', 'delete'].forEach((m) => { chain[m] = jest.fn(() => chain); });
  chain.maybeSingle = jest.fn(() => Promise.resolve(consume()));
  chain.update = jest.fn((payload: unknown) => { updates.push(payload); return chain; });
  chain.then = (f: (value: Resp) => unknown, r: (reason?: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(f, r);
  return chain;
}
const admin = { from: jest.fn(() => makeChain()) } as unknown as SupabaseClient;
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => { responses.length = 0; updates.length = 0; mockFetch.mockReset(); jest.clearAllMocks(); });

describe('runTeardownTask', () => {
  it('revoke_whatsapp deletes the Evolution instance and marks done', async () => {
    pushDb({ provider: 'evolution', instance_name: 'inst1', provider_base_url: 'https://wa', provider_api_key: 'k' });
    mockFetch.mockResolvedValue({ ok: true });
    const res = await runTeardownTask(admin, { id: 'x', tenant_id: 't1', task_type: 'revoke_whatsapp', attempts: 0, max_attempts: 5 } satisfies OffboardingTaskRow);
    expect(res.status).toBe('done');
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/instance/delete/inst1'), expect.objectContaining({ method: 'DELETE' }));
  });

  it('revoke_whatsapp with no config is a no-op -> skipped', async () => {
    pushDb(null);
    const res = await runTeardownTask(admin, { id: 'x', tenant_id: 't1', task_type: 'revoke_whatsapp', attempts: 0, max_attempts: 5 } satisfies OffboardingTaskRow);
    expect(res.status).toBe('skipped');
  });

  it('export_data calls the exporter and stores the url in payload -> done', async () => {
    const res = await runTeardownTask(admin, { id: 'x', tenant_id: 't1', task_type: 'export_data', attempts: 0, max_attempts: 5 } satisfies OffboardingTaskRow);
    expect(res.status).toBe('done');
    expect(res.payload).toEqual(expect.objectContaining({ export_url: 'https://x/export.zip' }));
  });

  it('marks failed when a provider call throws under max_attempts', async () => {
    pushDb({ provider: 'evolution', instance_name: 'inst1', provider_base_url: 'https://wa', provider_api_key: 'k' });
    mockFetch.mockRejectedValue(new Error('network'));
    const res = await runTeardownTask(admin, { id: 'x', tenant_id: 't1', task_type: 'revoke_whatsapp', attempts: 0, max_attempts: 5 } satisfies OffboardingTaskRow);
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/network/);
  });
});
