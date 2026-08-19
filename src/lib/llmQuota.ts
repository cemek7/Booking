import type { SupabaseClient } from '@supabase/supabase-js';

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  remaining?: number | null;
  quota?: number | null;
}

interface TenantQuotaRow {
  feature_flags?: unknown;
  llm_quota?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
      const raw = (tenant as TenantQuotaRow).feature_flags;
      if (typeof raw === 'string') {
        const parsed: unknown = JSON.parse(raw);
        flags = isRecord(parsed) ? parsed : null;
      } else if (isRecord(raw)) {
        flags = raw;
      }
    } catch { flags = null; }
    const premiumEnabled = Boolean(flags?.premium_llm);
    if (!premiumEnabled) return { allowed: false, reason: 'premium_llm_disabled' };

    const quotaValue = (tenant as TenantQuotaRow).llm_quota;
    const quota = typeof quotaValue === 'number' ? quotaValue : null;
    if (!quota) return { allowed: true, reason: 'no_quota_configured', quota: null, remaining: null };

    // Count current month usage (cheap aggregation)
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1); startOfMonth.setUTCHours(0, 0, 0, 0);
    const monthIso = startOfMonth.toISOString();
    const { count: usedCount, error: callsErr } = await supabase
      .from('llm_calls')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', monthIso);
    if (callsErr) return { allowed: true, reason: 'usage_lookup_failed', quota, remaining: null };
    const remaining = quota - (usedCount ?? 0);
    if (remaining <= 0) return { allowed: false, reason: 'quota_exhausted', quota, remaining: 0 };
    return { allowed: true, reason: 'ok', quota, remaining };
  } catch (e) {
    return { allowed: true, reason: 'guard_error_fallback' };
  }
}

export default { ensureTenantHasQuota };
