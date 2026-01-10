// Jest globals are available without import
import { ensureTenantHasQuota } from '@/lib/llmQuota';

function mockSupabase(rows: Record<string, any>) {
  return {
    from(table: string) {
      return {
        select() { return this; },
        eq() { return this; },
        gte() { return this; },
        limit() { return this; },
        maybeSingle() { return Promise.resolve({ data: rows[table] || null, error: null }); },
        head: true,
        async then() { return { data: [], error: null }; }
      } as any;
    }
  } as any;
}

describe('llmQuota.ensureTenantHasQuota', () => {
  it('blocks when premium_llm disabled', async () => {
    const supabase = mockSupabase({ tenants: { id: 't1', feature_flags: { premium_llm: false }, llm_quota: 100 } });
    const res = await ensureTenantHasQuota(supabase, 't1');
    expect(res.allowed).toBe(false);
  });
});
