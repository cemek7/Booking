export const dynamic = 'force-dynamic';
import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

/**
 * PATCH  /api/calendar/integrations/[integrationId]  — update sync settings
 * DELETE /api/calendar/integrations/[integrationId]  — disconnect the calendar
 *
 * Tenant-scoped: only the owning tenant can modify or remove an integration.
 */

const UpdateSchema = z
  .object({
    sync_enabled: z.boolean().optional(),
    sync_direction: z.enum(['bidirectional', 'to_google', 'from_google']).optional(),
  })
  .strip();

export const PATCH = createHttpHandler(
  async (ctx) => {
    const id = ctx.params?.integrationId;
    if (!id) throw ApiErrorFactory.validationError({ integrationId: 'Integration id is required' });
    const tenantId = ctx.user!.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Tenant context required');

    const parsed = UpdateSchema.safeParse(await parseJsonBody<unknown>(ctx.request));
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.') || '_', i.message]))
      );
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof parsed.data.sync_enabled === 'boolean') update.sync_enabled = parsed.data.sync_enabled;
    if (parsed.data.sync_direction) update.sync_direction = parsed.data.sync_direction;

    const { data, error } = await ctx.supabase
      .from('calendar_integrations')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id, sync_enabled, sync_direction')
      .maybeSingle();

    if (error) throw ApiErrorFactory.databaseError(error);
    if (!data) throw ApiErrorFactory.notFound('Calendar integration');

    return { success: true, integration: data };
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager'] }
);

export const DELETE = createHttpHandler(
  async (ctx) => {
    const id = ctx.params?.integrationId;
    if (!id) throw ApiErrorFactory.validationError({ integrationId: 'Integration id is required' });
    const tenantId = ctx.user!.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Tenant context required');

    const { error } = await ctx.supabase
      .from('calendar_integrations')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) throw ApiErrorFactory.databaseError(error);

    return { success: true };
  },
  'DELETE',
  { auth: true, roles: ['owner', 'manager'] }
);
