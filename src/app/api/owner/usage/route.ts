import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { getOwnerUsage } from '@/lib/services/owner-usage-service';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

export const GET = createHttpHandler(
  async (ctx) => {
    const usageData = await getOwnerUsage(ctx.supabase, ctx.user!.tenantId!);
    return usageData;
  },
  'GET',
  { auth: true, roles: ['owner', 'superadmin'] }
);

const BudgetBodySchema = z.object({
  action: z.enum(['set_budget', 'pause_ai', 'resume_ai']),
  budget_limit: z.number().positive().optional(),
  notification_threshold: z.number().min(1).max(100).optional(),
});

export const POST = createHttpHandler(
  async (ctx) => {
    const body = await ctx.request.json();
    const parsed = BudgetBodySchema.safeParse(body);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }

    const { action, budget_limit, notification_threshold } = parsed.data;
    const tenantId = ctx.user!.tenantId;
    if (!tenantId) throw ApiErrorFactory.badRequest('Tenant ID is required');

    if (action === 'set_budget') {
      if (!budget_limit) throw ApiErrorFactory.badRequest('budget_limit required for set_budget action');
      // Fetch existing settings first to merge rather than overwrite
      const { data: existing, error: readError } = await ctx.supabase
        .from('tenants')
        .select('settings')
        .eq('id', tenantId)
        .single();
      if (readError) throw ApiErrorFactory.databaseError(readError);
      if (!existing) throw ApiErrorFactory.notFound('Tenant configuration');
      const merged = { ...(existing?.settings || {}), llm_budget_limit: budget_limit, llm_notification_threshold: notification_threshold ?? 80 };
      const { error } = await ctx.supabase
        .from('tenants')
        .update({ settings: merged })
        .eq('id', tenantId);
      if (error) throw ApiErrorFactory.databaseError(error);
      return { message: 'Budget limit updated', budget_limit, notification_threshold: notification_threshold ?? 80 };
    }

    if (action === 'pause_ai' || action === 'resume_ai') {
      const enabled = action === 'resume_ai';
      // Fetch existing settings to merge
      const { data: existing, error: readError } = await ctx.supabase
        .from('tenants')
        .select('settings')
        .eq('id', tenantId)
        .single();
      if (readError) throw ApiErrorFactory.databaseError(readError);
      if (!existing) throw ApiErrorFactory.notFound('Tenant configuration');
      const merged = { ...(existing?.settings || {}), ai_features_enabled: enabled };
      const { error } = await ctx.supabase
        .from('tenants')
        .update({ settings: merged })
        .eq('id', tenantId);
      if (error) throw ApiErrorFactory.databaseError(error);
      return { message: `AI features ${enabled ? 'resumed' : 'paused'}` };
    }

    throw ApiErrorFactory.badRequest('Invalid action');
  },
  'POST',
  { auth: true, roles: ['owner', 'superadmin'] }
);
