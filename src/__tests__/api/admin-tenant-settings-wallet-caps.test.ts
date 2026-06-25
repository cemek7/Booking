import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/whatsapp/v2/tenantBrand', () => ({
  renameTenantBrand: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(),
}));

import { PUT } from '@/app/api/admin/tenant/[id]/settings/route';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

function createSupabase() {
  const calls: Array<{ table: string; op: string; payload?: Record<string, unknown> }> = [];

  const makeChain = (table: string) => {
    const chain = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      update: jest.fn((payload: Record<string, unknown>) => {
        calls.push({ table, op: 'update', payload });
        return chain;
      }),
      upsert: jest.fn(async (payload: Record<string, unknown>) => {
        calls.push({ table, op: 'upsert', payload });
        return { error: null };
      }),
      maybeSingle: jest.fn(async () => {
        if (table === 'tenants') {
          return {
            data: {
              id: 'tenant-1',
              name: 'Acme',
              timezone: 'UTC',
              preferred_llm_model: null,
              llm_token_rate: null,
            },
            error: null,
          };
        }
        if (table === 'ai_wallets') {
          return {
            data: { daily_budget_credits: 20000 },
            error: null,
          };
        }
        return { data: null, error: null };
      }),
    };

    return chain;
  };

  return {
    calls,
    client: {
      from: jest.fn((table: string) => makeChain(table)),
    },
  };
}

describe('admin tenant settings wallet caps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clamps owner daily budget to the platform max and writes it to ai_wallets', async () => {
    const { client: supabase, calls } = createSupabase();
    const { client: admin, calls: adminCalls } = createSupabase();
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(admin);
    const result = await PUT({
      request: {
        method: 'PUT',
        url: 'http://localhost/api/admin/tenant/tenant-1/settings',
        headers: { get: (key: string) => (key.toLowerCase() === 'x-tenant-id' ? 'tenant-1' : null) },
        json: async () => ({ daily_budget_credits: 999999 }),
      },
      user: { id: 'usr-1', email: 'owner@test.com', role: 'owner', tenantId: 'tenant-1' },
      supabase,
      params: { id: 'tenant-1' },
    } as never);

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(0);
    expect(adminCalls).toContainEqual({
      table: 'ai_wallets',
      op: 'upsert',
      payload: {
        tenant_id: 'tenant-1',
        daily_budget_credits: 20000,
      },
    });
    expect((result.row as Record<string, unknown>).daily_budget_credits).toBe(20000);
  });

  it('rejects a non-numeric daily budget payload', async () => {
    const { client: supabase } = createSupabase();
    const { client: admin } = createSupabase();
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(admin);

    await expect(PUT({
      request: {
        method: 'PUT',
        url: 'http://localhost/api/admin/tenant/tenant-1/settings',
        headers: { get: (key: string) => (key.toLowerCase() === 'x-tenant-id' ? 'tenant-1' : null) },
        json: async () => ({ daily_budget_credits: 'abc' }),
      },
      user: { id: 'usr-1', email: 'owner@test.com', role: 'owner', tenantId: 'tenant-1' },
      supabase,
      params: { id: 'tenant-1' },
    } as never)).rejects.toMatchObject({ code: 'validation_error' });
  });
});
