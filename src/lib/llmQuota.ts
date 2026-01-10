import type { SupabaseClient } from '@supabase/supabase-js';

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  remaining?: number | null;
  quota?: number | null;
}

/**
 * ensureTenantHasQuota: runtime guard for premium LLM usage.
 * Strategy:
 * 1. Fetch tenant row (expects optional columns: feature_flags JSON, llm_quota numeric).
 * 2. If feature flag `premium_llm` is falsey -> block.
 * 3. Count llm_calls for current calendar month; compare against llm_quota if present.
 * 4. Returns QuotaCheckResult; caller may throw if !allowed.
 */
export async function ensureTenantHasQuota(supabase: SupabaseClient, tenantId: string): Promise<QuotaCheckResult> {
  if (!tenantId) return { allowed: false, reason: 'tenant_missing' };
  try {
    const { data: tenant, error: terr } = await supabase
      .from('tenants')
      .select('id, feature_flags, llm_quota')
      .eq('id', tenantId)
      .maybeSingle();
    if (terr) {
      return { allowed: false, reason: 'tenant_fetch_failed' };
    }
    if (!tenant) return { allowed: false, reason: 'tenant_not_found' };

    // Feature flag check (object or JSON string tolerated)
    let flags: Record<string, unknown> | null = null;
    try {
      const raw = (tenant as any).feature_flags;
      if (raw && typeof raw === 'string') flags = JSON.parse(raw);
      else if (raw && typeof raw === 'object') flags = raw as Record<string, unknown>;
    } catch { flags = null; }
    const premiumEnabled = !!(flags && (flags as any).premium_llm);
    if (!premiumEnabled) return { allowed: false, reason: 'premium_llm_disabled' };

    const quota = typeof (tenant as any).llm_quota === 'number' ? Number((tenant as any).llm_quota) : null;
    if (!quota) return { allowed: true, reason: 'no_quota_configured', quota: null, remaining: null };

    // Count current month usage (cheap aggregation)
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1); startOfMonth.setUTCHours(0, 0, 0, 0);
    const monthIso = startOfMonth.toISOString();
    const { data: calls, error: callsErr } = await supabase
      .from('llm_calls')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', monthIso);
    if (callsErr) return { allowed: true, reason: 'usage_lookup_failed', quota, remaining: null };
    const used = (calls as any)?.length ?? (callsErr ? 0 : (calls as any)); // head:true returns empty array; rely on count
    // Supabase count is exposed via response.count
    const usedCount = (calls as any)?.length === 0 && typeof (calls as any).count === 'number' ? (calls as any).count : used;
    const remaining = quota - usedCount;
    if (remaining <= 0) return { allowed: false, reason: 'quota_exhausted', quota, remaining: 0 };
    return { allowed: true, reason: 'ok', quota, remaining };
  } catch (e) {
    return { allowed: true, reason: 'guard_error_fallback' };
  }
}

export default { ensureTenantHasQuota };
