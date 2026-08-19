export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { enterOffboarding } from '@/lib/offboarding/offboardService';

/**
 * DELETE /api/tenants/[tenantId]
 * Enters the tenant into the reversible off-boarding flow instead of performing
 * a hard cascade delete. Actual teardown and data purge happen asynchronously
 * via the nightly worker once the grace period expires.
 * Restricted to the tenant owner only.
 */
export const DELETE = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId as string;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const admin = createSupabaseAdminClient();
    const { data: tenant } = await admin
      .from('tenants').select('id, lifecycle_state').eq('id', tenantId).single();
    if (!tenant) throw ApiErrorFactory.notFound('Tenant not found');

    // Repurposed: DELETE now enters the reversible off-boarding flow instead of a
    // hard cascade delete. Actual teardown/purge happens via the nightly worker.
    await enterOffboarding(admin, {
      tenantId, reason: 'voluntary', actorUserId: ctx.user!.id, actorRole: ctx.user!.role,
    });
    return { success: true, scheduled: tenantId };
  },
  'DELETE',
  { auth: true, roles: ['owner'] }
);
