export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

/**
 * GET /api/calendar/integrations?tenant_id=
 *
 * Lists the tenant's connected calendars for CalendarSettings. Tokens are
 * never returned. Maps DB columns to the shape the UI expects
 * (calendar_name ← calendar_id, calendar_email ← email).
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Tenant context required');

    const { data, error } = await ctx.supabase
      .from('calendar_integrations')
      .select('id, provider, calendar_id, email, staff_id, sync_enabled, sync_direction, events_synced, last_synced, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw ApiErrorFactory.databaseError(error);

    const integrations = (data ?? []).map((row) => {
      const r = row as {
        id: string; provider: string | null; calendar_id: string | null; email: string | null;
        staff_id: string | null; sync_enabled: boolean | null; sync_direction: string | null;
        events_synced: number | null; last_synced: string | null;
      };
      return {
        id: r.id,
        provider: r.provider ?? 'google',
        calendar_name: r.calendar_id ?? 'Calendar',
        calendar_email: r.email ?? '',
        sync_enabled: !!r.sync_enabled,
        sync_direction: (r.sync_direction as string) ?? 'bidirectional',
        conflict_resolution: 'notify' as const,
        events_synced: r.events_synced ?? 0,
        last_synced: r.last_synced,
        sync_errors: null,
        staff_id: r.staff_id,
      };
    });

    return { integrations };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);
