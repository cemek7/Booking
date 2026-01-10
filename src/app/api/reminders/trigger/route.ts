import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

/**
 * POST /api/reminders/trigger
 * 
 * Trigger reminder processing. Fetches pending reminders due for processing.
 * This is an internal endpoint - typically called by a background worker or scheduler.
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
    const limit = body.limit ? Number(body.limit) : 50;

    const nowIso = new Date().toISOString();
    const { data, error } = await ctx.supabase
      .from('reminders')
      .select('*')
      .lte('remind_at', nowIso)
      .eq('status', 'pending')
      .eq('tenant_id', tenantId)
      .order('remind_at', { ascending: true })
      .limit(limit);

    if (error) throw ApiErrorFactory.internal('Failed to fetch reminders');

    return { data: data ?? [] };
  },
  'POST',
  { auth: true }
);
