import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { isGlobalAdmin } from '@/types/unified-permissions';

/**
 * POST /api/jobs/enqueue-reminders
 * 
 * Enqueue a reminder processing job. Only global admins or tenant managers can enqueue jobs.
 * 
 * Request body: { limit?: number }
 */

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const body = await ctx.request.json();
    const { limit = 50 } = body || {};

    // Check permissions
    const okGlobal = await isGlobalAdmin(ctx.supabase, ctx.user!.id, ctx.user!.email);
    if (!okGlobal) {
      throw ApiErrorFactory.insufficientPermissions(['admin']);
    }

    // Enqueue the job
    const payload = { job_type: 'process_reminders', tenant_id: tenantId, limit };
    const { data, error } = await ctx.supabase
      .from('jobs')
      .insert([{
        type: 'process_reminders',
        payload,
        status: 'pending',
        attempts: 0,
        scheduled_at: new Date().toISOString(),
      }])
      .select()
      .maybeSingle();

    if (error) throw ApiErrorFactory.internal('Failed to enqueue job');

    return { data };
  },
  'POST',
  { auth: true }
);
  });
}
