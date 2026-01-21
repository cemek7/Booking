import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

/**
 * POST /api/tenants/:tenantId/whatsapp/connect
 * Marks integration status as 'pending' and echoes back current settings.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    // Verify the caller has access to this tenant
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    // Fetch current tenant settings
    const { data: current, error: fetchError } = await ctx.supabase
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .single();

    if (fetchError) {
      throw ApiErrorFactory.databaseError(fetchError);
    }

    // Update settings with pending integration status
    const merged = { ...(current?.settings || {}), integrationStatus: 'pending' };

    const { error: updateError } = await ctx.supabase
      .from('tenants')
      .update({ settings: merged })
      .eq('id', tenantId);

    if (updateError) {
      throw ApiErrorFactory.databaseError(updateError);
    }

    return { status: 'pending', settings: merged };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);
