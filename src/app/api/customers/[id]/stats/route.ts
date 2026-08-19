export const dynamic = 'force-dynamic';
import { createHttpHandler, getRouteParam } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

/**
 * GET /api/customers/{id}/stats
 * Retrieves aggregate statistics for a customer.
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
      .select('tenant_id, customer_id, lifetime_bookings, last_visit, no_show_count')
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

    const totalBookings = Number(customer?.lifetime_bookings ?? 0);
    const lastBookingAt = customer?.last_visit ?? null;
    let status = 'regular';
    if (totalBookings >= 10) {
      status = 'vip';
    }
    if (Number(customer?.no_show_count ?? 0) >= 3) {
      status = 'at_risk';
    }

    return {
      totalBookings,
      lastBookingAt,
      status,
    };
  },
  'GET',
  { auth: true }
);
