import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

export const GET = createHttpHandler(
  async (ctx) => {
    const { searchParams } = new URL(ctx.request.url);
    const tenantId = searchParams.get('tenant_id');

    if (!tenantId) {
      throw ApiErrorFactory.badRequest('tenant_id required');
    }

    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const from = fromParam ? new Date(fromParam) : null;
    const to = toParam ? new Date(toParam) : null;

    let query = ctx.supabase.from('llm_calls').select('id,usage,created_at,raw').eq('tenant_id', tenantId);
    if (from) query = query.gte('created_at', from.toISOString());
    if (to) query = query.lte('created_at', to.toISOString());

    const { data, error } = await query.limit(10000);

    if (error) {
      if ((error as { code?: string })?.code === '42P01') {
        return { requests: 0, total_tokens: 0, cost: 0 };
      }
      throw ApiErrorFactory.internal('Failed to query LLM calls');
    }

    let totalRequests = (data || []).length;
    let totalTokens = 0;
    let estimatedCost = 0;

    for (const r of data || []) {
      const usage = (r as Record<string, unknown>)['usage'] as Record<string, unknown> | null;
      if (usage) {
        const ut = (usage.total_tokens ?? usage.total ?? usage.tokens ?? usage.token_count) as number | undefined;
        const prompt = (usage.prompt_tokens ?? usage.prompt) as number | undefined;
        const completion = (usage.completion_tokens ?? usage.completion) as number | undefined;
        const tokens = ut ?? ((prompt || 0) + (completion || 0));
        if (typeof tokens === 'number') totalTokens += tokens;
        const cost = (usage.estimated_cost ?? usage.cost ?? null) as number | null;
        if (typeof cost === 'number') estimatedCost += cost;
      }
    }

    return { requests: totalRequests, total_tokens: totalTokens, cost: estimatedCost };
  },
  'GET',
  { auth: true, roles: ['owner', 'admin', 'global_admin'] }
);
