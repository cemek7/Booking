export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { GoogleCalendarIntegration } from '@/lib/integrations/googleCalendar';

/**
 * POST /api/calendar/sync/[integrationId]
 *
 * Pulls events from the connected Google Calendar into the local schedule and
 * records the result. Returns { events_synced, conflicts_detected }.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const id = ctx.params?.integrationId;
    if (!id) throw ApiErrorFactory.validationError({ integrationId: 'Integration id is required' });
    const tenantId = ctx.user!.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Tenant context required');

    // Load the integration (with tokens) scoped to the tenant.
    const { data: integration, error } = await ctx.supabase
      .from('calendar_integrations')
      .select('id, staff_id, calendar_id, access_token, refresh_token, sync_enabled, sync_direction')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) throw ApiErrorFactory.databaseError(error);
    if (!integration) throw ApiErrorFactory.notFound('Calendar integration');

    const row = integration as {
      staff_id: string | null; calendar_id: string | null;
      access_token: string | null; refresh_token: string | null;
      sync_enabled: boolean | null; sync_direction: string | null;
    };

    if (!row.access_token || !row.refresh_token || !row.calendar_id) {
      throw ApiErrorFactory.validationError({ _: 'This calendar is not fully connected. Reconnect it and try again.' });
    }

    const config = {
      calendar_id: row.calendar_id,
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      sync_enabled: row.sync_enabled ?? true,
      conflict_resolution: 'notify' as const,
      sync_direction: (row.sync_direction as 'bidirectional' | 'to_google' | 'from_google') ?? 'bidirectional',
    };

    const now = new Date();
    const timeMax = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    let result;
    try {
      const gcal = new GoogleCalendarIntegration();
      result = await gcal.syncFromGoogle(tenantId, row.staff_id ?? '', config, now, timeMax);
    } catch (err) {
      throw ApiErrorFactory.internalServerError(
        new Error(`Calendar sync failed: ${err instanceof Error ? err.message : 'unknown error'}`)
      );
    }

    // Record the sync outcome on the integration.
    await ctx.supabase
      .from('calendar_integrations')
      .update({ last_synced: result.sync_timestamp.toISOString(), events_synced: result.events_synced, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId);

    return {
      success: result.success,
      events_synced: result.events_synced,
      conflicts_detected: result.conflicts_detected,
      errors: result.errors,
    };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);
