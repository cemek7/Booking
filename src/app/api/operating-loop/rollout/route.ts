import { z } from 'zod';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHttpHandler, getVerifiedTenantId, type RouteContext } from '@/lib/error-handling/route-handler';

export const dynamic = 'force-dynamic';

const RolloutSchema = z.object({ enabled: z.boolean() }).strict();

async function readTenantMetadata(ctx: RouteContext, tenantId: string) {
  const { data, error } = await ctx.supabase
    .from('tenants')
    .select('metadata')
    .eq('id', tenantId)
    .maybeSingle();
  if (error) throw ApiErrorFactory.databaseError(error);
  if (!data) throw ApiErrorFactory.notFound('Tenant');
  return data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
    ? data.metadata as Record<string, unknown>
    : {};
}

export const GET = createHttpHandler(
  async (ctx) => {
    const metadata = await readTenantMetadata(ctx, getVerifiedTenantId(ctx));
    return { enabled: metadata.daily_operating_loop_enabled === true };
  },
  'GET',
  { auth: true, roles: ['owner'] },
);

export const PUT = createHttpHandler(
  async (ctx) => {
    const parsed = RolloutSchema.safeParse(await ctx.request.json());
    if (!parsed.success) throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    const tenantId = getVerifiedTenantId(ctx);
    const metadata = await readTenantMetadata(ctx, tenantId);
    const { error } = await ctx.supabase
      .from('tenants')
      .update({ metadata: { ...metadata, daily_operating_loop_enabled: parsed.data.enabled } })
      .eq('id', tenantId);
    if (error) throw ApiErrorFactory.databaseError(error);
    return { enabled: parsed.data.enabled };
  },
  'PUT',
  { auth: true, roles: ['owner'] },
);
