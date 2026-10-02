import { runTeardownTask, type OffboardingTaskRow } from '@/lib/offboarding/teardownTasks';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/offboarding/exporter', () => ({ generateTenantExport: jest.fn() }));
jest.mock('@/lib/whatsapp/providerSecrets', () => ({ getStoredProviderApiKey: jest.fn() }));

let rows: Array<{ subaccount_code: string }> = [];
const updates: unknown[] = [];
const tables: string[] = [];
const admin = {
  from: jest.fn((t: string) => {
    tables.push(t);
    const chain: Record<string, unknown> = {};
    chain.update = jest.fn((p: unknown) => { updates.push(p); return chain; });
    ['eq', 'neq'].forEach((m) => { chain[m] = jest.fn(() => chain); });
    chain.select = jest.fn(() => Promise.resolve({ data: rows, error: null }));
    return chain;
  }),
} as unknown as SupabaseClient;

const task = { id: 'x', tenant_id: 't1', task_type: 'close_paystack_subaccount', attempts: 0, max_attempts: 5 } satisfies OffboardingTaskRow;

beforeEach(() => { rows = []; updates.length = 0; tables.length = 0; });

describe('close_paystack_subaccount', () => {
  it('suspends the settlement account and reports the code', async () => {
    rows = [{ subaccount_code: 'ACCT_1' }];
    const res = await runTeardownTask(admin, task);
    expect(tables[0]).toBe('tenant_payment_accounts');
    expect(tables).not.toContain('tenants');
    expect(updates[0]).toMatchObject({ status: 'suspended' });
    expect(res).toMatchObject({ status: 'done', payload: { suspended_subaccount: 'ACCT_1' } });
  });

  it('skips when the tenant has no settlement account', async () => {
    const res = await runTeardownTask(admin, task);
    expect(res.status).toBe('skipped');
  });
});
