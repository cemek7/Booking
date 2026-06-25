export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { fetchSubaccount, createSubaccount, updateSubaccount } from '@/lib/paystack';

const PLATFORM_FEE = Number(process.env.PAYSTACK_PLATFORM_FEE_PERCENT ?? 5);

async function getTenantId(ctx: any): Promise<string> {
  const { data: tenantUser } = await ctx.supabase
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', ctx.user!.id)
    .single();
  if (!tenantUser) throw ApiErrorFactory.notFound('Tenant');
  return tenantUser.tenant_id;
}

/** GET /api/payments/subaccounts — fetch current subaccount for authenticated tenant */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = await getTenantId(ctx);

    const { data: tenant } = await ctx.supabase
      .from('tenants')
      .select('metadata')
      .eq('id', tenantId)
      .single();

    const code: string | undefined = (tenant?.metadata as any)?.paystack_subaccount_code;
    if (!code) return { configured: false };

    const result = await fetchSubaccount(code);
    if (!result.success) throw ApiErrorFactory.databaseError(new Error(result.error));

    return { configured: true, subaccount: result.subaccount };
  },
  'GET',
  { auth: true, roles: ['owner'] }
);

/** POST /api/payments/subaccounts — create subaccount (first-time setup) */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = await getTenantId(ctx);
    const body = await ctx.request.json();
    const { businessName, settlementBank, accountNumber, primaryContactEmail } = body;

    if (!businessName || !settlementBank || !accountNumber || !primaryContactEmail) {
      throw ApiErrorFactory.badRequest('businessName, settlementBank, accountNumber, primaryContactEmail');
    }

    const result = await createSubaccount({
      businessName,
      settlementBank,
      accountNumber,
      primaryContactEmail,
      percentageCharge: PLATFORM_FEE,
    });

    if (!result.success) throw ApiErrorFactory.databaseError(new Error(result.error));

    // Persist subaccount code in tenant metadata
    const { data: tenant } = await ctx.supabase
      .from('tenants')
      .select('metadata')
      .eq('id', tenantId)
      .single();

    const existingMeta = (tenant?.metadata as Record<string, unknown>) ?? {};
    await ctx.supabase
      .from('tenants')
      .update({
        metadata: {
          ...existingMeta,
          paystack_subaccount_code: result.subaccount!.subaccountCode,
        },
      })
      .eq('id', tenantId);

    return { success: true, subaccount: result.subaccount };
  },
  'POST',
  { auth: true, roles: ['owner'] }
);

/** PUT /api/payments/subaccounts — update existing subaccount */
export const PUT = createHttpHandler(
  async (ctx) => {
    const tenantId = await getTenantId(ctx);

    const { data: tenant } = await ctx.supabase
      .from('tenants')
      .select('metadata')
      .eq('id', tenantId)
      .single();

    const code: string | undefined = (tenant?.metadata as any)?.paystack_subaccount_code;
    if (!code) throw ApiErrorFactory.badRequest('No subaccount configured for this tenant');

    const body = await ctx.request.json();
    const { settlementBank, accountNumber, primaryContactEmail } = body;

    const result = await updateSubaccount(code, { settlementBank, accountNumber, primaryContactEmail });
    if (!result.success) throw ApiErrorFactory.databaseError(new Error(result.error));

    return { success: true, subaccount: result.subaccount };
  },
  'PUT',
  { auth: true, roles: ['owner'] }
);
