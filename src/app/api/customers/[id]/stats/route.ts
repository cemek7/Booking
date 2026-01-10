import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

interface RouteParams {
  params: { id: string };
}

/**
 * GET /api/customers/{id}/stats
 * Retrieves aggregate statistics for a customer.
 * Requires authentication.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    // Extract customer ID from route params
    const customerId = (ctx as any).params?.id;
    
    if (!customerId) {
      throw ApiErrorFactory.badRequest('Customer ID is required');
    }

    // Fetch the customer to get their tenant_id and other details
    const { data: customer, error: customerError } = await ctx.supabase
      .from('customers')
      .select('id, tenant_id, notes')
      .eq('id', customerId)
      .single();

    if (customerError || !customer) {
      throw ApiErrorFactory.notFound('Customer not found');
    }

    // Verify tenant access
    if (customer.tenant_id !== ctx.user!.tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this customer');
    }

    // Get total number of bookings
    const { count: totalBookings, error: countError } = await ctx.supabase
      .from('reservations')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', customer.tenant_id)
      .eq('customer_id', customer.id);

    if (countError) throw countError;

    // Get the last booking date
    const { data: lastBooking, error: lastBookingError } = await ctx.supabase
      .from('reservations')
      .select('start_at')
      .eq('tenant_id', customer.tenant_id)
      .eq('customer_id', customer.id)
      .order('start_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastBookingError) throw lastBookingError;
    const lastBookingAt = lastBooking?.start_at ?? null;

    // Determine customer status (e.g., 'vip', 'regular')
    let status = 'regular';
    if ((totalBookings ?? 0) >= 10) {
      status = 'vip';
    }
    // Allow manual override via notes
    if (customer.notes && customer.notes.toLowerCase().includes('vip')) {
      status = 'vip';
    }

    return {
      totalBookings: totalBookings ?? 0,
      lastBookingAt,
      status,
    };
  },
  'GET',
  { auth: true }
);
