import { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '@/lib/error-handling/api-error';
import { z } from 'zod';

const TenantIdSchema = z.string().uuid();

interface LlmCallRow {
  tenant_id: string;
  action: string | null;
  usage: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number; cost?: number } | null;
  created_at: string;
}

interface UsageData {
  currentMonthUsage: {
    openrouter_calls: number;
    total_tokens: number;
    cost_usd: string;
    intent_detection_calls: number;
    paraphraser_calls: number;
    conversation_processing: number;
  };
  lastMonthUsage: {
    openrouter_calls: number;
    total_tokens: number;
    cost_usd: string;
    intent_detection_calls: number;
    paraphraser_calls: number;
    conversation_processing: number;
  };
  plan: string;
  limits: { monthly_tokens: number; monthly_calls: number; monthly_cost_limit: number };
  usagePercentages: { tokenUsagePercent: number; callUsagePercent: number; costUsagePercent: number };
  aiConversion: { aiAssistedBookings: number; totalBookings: number; aiConversionRate: number };
  dailyUsage: Array<{ date: string; calls: number; tokens: number }>;
  topUsers: Array<{ user_id: string; name: string; calls: number; tokens: number }>;
  costBreakdown: { intent_detection: string; paraphrasing: string; conversation_processing: string; other: string };
}

function aggregateLlmRows(rows: LlmCallRow[]) {
  let totalTokens = 0;
  let costUsd = 0;
  let intentCalls = 0;
  let paraphraserCalls = 0;
  let convProcessing = 0;
  for (const r of rows) {
    totalTokens += r.usage?.total_tokens || 0;
    costUsd += r.usage?.cost || 0;
    const action = (r.action || '').toLowerCase();
    if (action.includes('intent')) intentCalls++;
    else if (action.includes('paraphras')) paraphraserCalls++;
    else if (action.includes('convers') || action.includes('chat')) convProcessing++;
  }
  return {
    openrouter_calls: rows.length,
    total_tokens: totalTokens,
    cost_usd: costUsd.toFixed(4),
    intent_detection_calls: intentCalls,
    paraphraser_calls: paraphraserCalls,
    conversation_processing: convProcessing,
  };
}

export async function getOwnerUsage(
  supabase: SupabaseClient,
  tenantId: string
): Promise<UsageData> {
  const validatedTenantId = TenantIdSchema.safeParse(tenantId);
  if (!validatedTenantId.success) {
    throw new ApiError('VALIDATION_ERROR', 'Invalid tenant ID', 400);
  }

  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Fetch all data in parallel
    const [
      tenantResult,
      currentLlmResult,
      lastLlmResult,
      dailyLlmResult,
      reservationsResult,
    ] = await Promise.all([
      supabase
        .from('tenants')
        .select('plan, status, settings')
        .eq('id', validatedTenantId.data)
        .single(),
      supabase
        .from('llm_calls')
        .select('tenant_id, action, usage, created_at')
        .eq('tenant_id', validatedTenantId.data)
        .gte('created_at', startOfMonth.toISOString()),
      supabase
        .from('llm_calls')
        .select('tenant_id, action, usage, created_at')
        .eq('tenant_id', validatedTenantId.data)
        .gte('created_at', startOfLastMonth.toISOString())
        .lte('created_at', endOfLastMonth.toISOString()),
      supabase
        .from('llm_calls')
        .select('action, usage, created_at')
        .eq('tenant_id', validatedTenantId.data)
        .gte('created_at', sevenDaysAgo.toISOString()),
      supabase
        .from('reservations')
        .select('id, status, metadata')
        .eq('tenant_id', validatedTenantId.data)
        .gte('created_at', startOfMonth.toISOString()),
    ]);

    if (tenantResult.error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch tenant info', 500, undefined, tenantResult.error as Error);
    if (currentLlmResult.error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch current LLM usage', 500, undefined, currentLlmResult.error as Error);
    if (lastLlmResult.error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch last month LLM usage', 500, undefined, lastLlmResult.error as Error);
    if (dailyLlmResult.error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch daily LLM usage', 500, undefined, dailyLlmResult.error as Error);
    if (reservationsResult.error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch reservations', 500, undefined, reservationsResult.error as Error);

    const tenant = tenantResult.data;

    // Aggregate current & last month LLM usage from real data
    const currentMonthUsage = aggregateLlmRows((currentLlmResult.data || []) as LlmCallRow[]);
    const lastMonthUsage = aggregateLlmRows((lastLlmResult.data || []) as LlmCallRow[]);

    // Plan limits
    const planLimits = {
      free:    { monthly_tokens: 10000,  monthly_calls: 1000,  monthly_cost_limit: 5   },
      premium: { monthly_tokens: 500000, monthly_calls: 20000, monthly_cost_limit: 200 },
    };
    const limits = planLimits[tenant.plan as keyof typeof planLimits] || planLimits.free;

    const usagePercentages = {
      tokenUsagePercent: (currentMonthUsage.total_tokens / limits.monthly_tokens) * 100,
      callUsagePercent:  (currentMonthUsage.openrouter_calls / limits.monthly_calls) * 100,
      costUsagePercent:  (parseFloat(currentMonthUsage.cost_usd) / limits.monthly_cost_limit) * 100,
    };

    // AI conversion: reservations where raw.ai_assisted is true (or status was triggered by AI)
    const reservations = reservationsResult.data || [];
    const aiAssistedCount = reservations.filter(r => {
      const raw = (r as { metadata?: Record<string, unknown> | null }).metadata ?? null;
      return raw?.ai_assisted === true || raw?.source === 'ai' || raw?.channel === 'whatsapp';
    }).length;
    const totalBookings = reservations.length;
    const aiConversionRate = totalBookings > 0 ? (aiAssistedCount / totalBookings) * 100 : 0;

    // Daily usage for last 7 days from real llm_calls
    const dailyMap: Record<string, { calls: number; tokens: number }> = {};
    for (const r of (dailyLlmResult.data || []) as LlmCallRow[]) {
      const day = r.created_at.split('T')[0];
      if (!dailyMap[day]) dailyMap[day] = { calls: 0, tokens: 0 };
      dailyMap[day].calls++;
      dailyMap[day].tokens += r.usage?.total_tokens || 0;
    }
    const dailyUsage = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() - (6 - i));
      const key = d.toISOString().split('T')[0];
      return { date: key, calls: dailyMap[key]?.calls || 0, tokens: dailyMap[key]?.tokens || 0 };
    });

    // Top features by LLM call volume (group by action since llm_calls has no user_id)
    const featureMap: Record<string, { calls: number; tokens: number }> = {};
    for (const r of (currentLlmResult.data || []) as LlmCallRow[]) {
      const feature = r.action || 'general';
      if (!featureMap[feature]) featureMap[feature] = { calls: 0, tokens: 0 };
      featureMap[feature].calls++;
      featureMap[feature].tokens += r.usage?.total_tokens || 0;
    }
    const topFeatures = Object.entries(featureMap)
      .sort((a, b) => b[1].calls - a[1].calls)
      .slice(0, 5)
      .map(([action, stats]) => ({
        user_id: action,
        name: action,
        calls: stats.calls,
        tokens: stats.tokens,
      }));

    // Cost breakdown derived from real action-grouped costs
    const costByAction: Record<string, number> = {};
    for (const r of (currentLlmResult.data || []) as LlmCallRow[]) {
      const action = (r.action || 'other').toLowerCase();
      const category = action.includes('intent') ? 'intent_detection'
        : action.includes('paraphras') ? 'paraphrasing'
        : action.includes('convers') || action.includes('chat') ? 'conversation_processing'
        : 'other';
      costByAction[category] = (costByAction[category] || 0) + (r.usage?.cost || 0);
    }
    const costBreakdown = {
      intent_detection:        (costByAction['intent_detection']        || 0).toFixed(4),
      paraphrasing:            (costByAction['paraphrasing']            || 0).toFixed(4),
      conversation_processing: (costByAction['conversation_processing'] || 0).toFixed(4),
      other:                   (costByAction['other']                   || 0).toFixed(4),
    };

    return {
      currentMonthUsage,
      lastMonthUsage,
      plan: tenant.plan,
      limits,
      usagePercentages,
      aiConversion: { aiAssistedBookings: aiAssistedCount, totalBookings, aiConversionRate },
      dailyUsage,
      topUsers: topFeatures,
      costBreakdown,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('INTERNAL_ERROR', 'An unexpected error occurred', 500, undefined, error as Error);
  }
}
