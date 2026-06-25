export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { SIAS_OUTCOME_ATRIBUTION } from '@/lib/sias';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    const isSuperadmin = ctx.user?.role === 'superadmin';
    const dataClient = isSuperadmin ? createSupabaseAdminClient() : ctx.supabase;
    if (!tenantId && !isSuperadmin) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });
    }
    const revenueWindowStart = new Date();
    revenueWindowStart.setDate(revenueWindowStart.getDate() - 30);

    const campaignsQuery = dataClient
      .from('sias_campaign_runs')
      .select('id, campaign_type, action, target_phone, status, attempts, scheduled_for, next_retry_at, source_event, metadata, created_at, error')
      .order('created_at', { ascending: false })
      .limit(25);

    const escalationsQuery = dataClient
      .from('escalation_queue')
      .select('id, customer_phone, session_id, reason, status, assigned_agent_id, created_at, resolved_at')
      .order('created_at', { ascending: false })
      .limit(20);

    const memoryQuery = dataClient
      .from('sias_operational_memory')
      .select('id, memory_key, memory_value, source, confidence, hit_count, last_seen_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(20);

    const attributionQuery = dataClient
      .from('sias_outcome_attributions')
      .select('signal, value, source_event, attributed_to, created_at')
      .gte('created_at', revenueWindowStart.toISOString())
      .order('created_at', { ascending: false })
      .limit(250);

    const [campaignRes, escalationRes, memoryRes, attributionRes] = await Promise.all([
      tenantId ? campaignsQuery.eq('tenant_id', tenantId) : campaignsQuery,
      tenantId ? escalationsQuery.eq('tenant_id', tenantId) : escalationsQuery,
      tenantId ? memoryQuery.eq('tenant_id', tenantId) : memoryQuery,
      tenantId ? attributionQuery.eq('tenant_id', tenantId) : attributionQuery,
    ]);

    const outcomes = new Map<string, { id: string; label: string; count: number; value: number }>();
    for (const item of SIAS_OUTCOME_ATRIBUTION) {
      outcomes.set(item.id, { id: item.id, label: item.label, count: 0, value: 0 });
    }
    for (const row of attributionRes.data ?? []) {
      const id = String((row as { signal?: string }).signal ?? 'revenue_recovery');
      const current = outcomes.get(id) ?? { id, label: id.replace(/_/g, ' '), count: 0, value: 0 };
      current.count += 1;
      current.value += Number((row as { value?: number }).value ?? 0);
      outcomes.set(id, current);
    }

    const revenueRecoveredByDay = new Map<string, { day: string; revenue: number; count: number }>();
    for (const row of attributionRes.data ?? []) {
      const signal = String((row as { signal?: string }).signal ?? '');
      if (signal !== 'revenue_recovery') continue;
      const createdAt = String((row as { created_at?: string }).created_at ?? '');
      const day = createdAt.slice(0, 10);
      if (!day) continue;
      const current = revenueRecoveredByDay.get(day) ?? { day, revenue: 0, count: 0 };
      current.revenue += Number((row as { value?: number }).value ?? 0);
      current.count += 1;
      revenueRecoveredByDay.set(day, current);
    }

    return {
      campaigns: campaignRes.data ?? [],
      escalations: escalationRes.data ?? [],
      memory: memoryRes.data ?? [],
      outcomes: Array.from(outcomes.values()),
      revenue_recovered_by_day: Array.from(revenueRecoveredByDay.values()).sort((a, b) => a.day.localeCompare(b.day)),
      totals: {
        open_escalations: (escalationRes.data ?? []).filter((row: { status?: string | null }) => row.status === 'pending' || row.status === 'claimed').length,
        retrying_campaigns: (campaignRes.data ?? []).filter((row: { status?: string | null }) => row.status === 'retry_scheduled').length,
        pending_campaigns: (campaignRes.data ?? []).filter((row: { status?: string | null }) => row.status === 'pending').length,
      },
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff', 'superadmin'], requireTenantMembership: false }
);
