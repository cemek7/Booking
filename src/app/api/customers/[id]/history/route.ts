export const dynamic = 'force-dynamic';
import { createHttpHandler, getRouteParam } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

/**
 * GET /api/customers/{id}/history
 * Retrieves a customer's reservation history and lifetime spend.
 * Requires authentication.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const customerId = getRouteParam(ctx.params, 'id');
    if (!customerId) {
      throw ApiErrorFactory.badRequest('Customer ID is required');
    }

    const { data: customer, error: customerError } = await ctx.supabase
      .from('customer_profile_summary')
      .select('tenant_id, customer_id, lifetime_value_cents')
      .eq('customer_id', customerId)
      .maybeSingle();

    const fallbackCustomer = !customer
      ? await ctx.supabase
          .from('customers')
          .select('id, tenant_id')
          .eq('id', customerId)
          .maybeSingle()
      : null;

    const tenantId = customer?.tenant_id ?? fallbackCustomer?.data?.tenant_id;
    if (customerError || !tenantId) {
      throw ApiErrorFactory.notFound('Customer not found');
    }

    if (tenantId !== ctx.user!.tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this customer');
    }

    const { data: recentReservations, error: recentError } = await ctx.supabase
      .from('reservations')
      .select('id, start_at, status, price_cents_snapshot')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .order('start_at', { ascending: false })
      .limit(5);

    if (recentError) throw ApiErrorFactory.internalServerError(new Error('Failed to fetch recent reservations'));

    const recentWithTotals = (recentReservations ?? []).map((res: { id: string; start_at: string; status: string; price_cents_snapshot?: number | null }) => {
      return { ...res, total: Number(res.price_cents_snapshot ?? 0) / 100 };
    });

    return {
      lifetimeSpend: Number(customer?.lifetime_value_cents ?? 0) / 100,
      recent: recentWithTotals,
    };
  },
  'GET',
  { auth: true }
);
