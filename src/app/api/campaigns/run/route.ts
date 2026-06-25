export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { runDueSiasCampaigns } from '@/lib/siasCampaignRunner';

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });
    const body = await ctx.request.json().catch(() => ({}));
    const campaignId = typeof body?.campaignId === 'string' && body.campaignId.trim() ? body.campaignId.trim() : undefined;
    try {
      return await runDueSiasCampaigns(ctx.supabase, tenantId, 25, { campaignId });
    } catch (error) {
      throw ApiErrorFactory.internalServerError(error instanceof Error ? error : new Error('Failed to process campaigns'));
    }
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
