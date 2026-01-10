import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

interface RouteParams {
  params: { id: string };
}

/**
 * GET /api/customers/{id}/history
 * Retrieves a customer's reservation history and lifetime spend.
 * Requires authentication.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    // Extract customer ID from route params
    const customerId = (ctx as any).params?.id;
    
    if (!customerId) {
      throw ApiErrorFactory.badRequest('Customer ID is required');
    }

    // Fetch the customer to get their tenant_id
    const { data: customer, error: customerError } = await ctx.supabase
      .from('customers')
      .select('id, tenant_id, phone')
      .eq('id', customerId)
      .single();

    if (customerError || !customer) {
      throw ApiErrorFactory.notFound('Customer not found');
    }

    // Verify tenant access
    if (customer.tenant_id !== ctx.user!.tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this customer');
    }

    // Calculate lifetime spend
    const { data: allReservations, error: reservationsError } = await ctx.supabase
      .from('reservations')
      .select('id')
      .eq('tenant_id', customer.tenant_id)
      .eq('customer_id', customer.id);

    if (reservationsError) throw reservationsError;

    let lifetimeSpend = 0;
    if (allReservations.length > 0) {
      const reservationIds = allReservations.map(r => r.id);
      const { data: services, error: servicesError } = await ctx.supabase
        .from('reservation_services')
        .select('quantity, services(price)')
        .in('reservation_id', reservationIds);
      
      if (servicesError) throw servicesError;

      lifetimeSpend = services.reduce((total, item) => {
        const price = item.services?.price ?? 0;
        const quantity = item.quantity ?? 1;
        return total + (price * quantity);
      }, 0);
    }

    // Fetch recent reservations with their totals
    const { data: recentReservations, error: recentError } = await ctx.supabase
      .from('reservations')
      .select('id, start_at, status')
      .eq('tenant_id', customer.tenant_id)
      .eq('customer_id', customer.id)
      .order('start_at', { ascending: false })
      .limit(5);

    if (recentError) throw recentError;

    const recentWithTotals = await Promise.all(recentReservations.map(async (res) => {
      const { data: services, error } = await ctx.supabase
        .from('reservation_services')
        .select('quantity, services(price)')
        .eq('reservation_id', res.id);
      
      if (error) {
        console.error(`Failed to fetch services for reservation ${res.id}:`, error);
        return { ...res, total: 0 };
      }

      const total = services.reduce((acc, item) => {
        const price = item.services?.price ?? 0;
        const quantity = item.quantity ?? 1;
        return acc + (price * quantity);
      }, 0);

      return { ...res, total };
    }));

    return {
      lifetimeSpend,
      recent: recentWithTotals,
    };
  },
  'GET',
  { auth: true }
);
