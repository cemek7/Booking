import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { getPaginationParams } from '@/lib/error-handling/migration-helpers';

/**
 * GET,POST /api/reservations
 *
 * GET: Fetch reservations, optionally filtered by tenant_id
 * POST: Create a new reservation
 *
 * GET Query params:
 * - tenant_id (optional): Filter by tenant (defaults to ctx.user.tenantId)
 *
 * POST Body: {
 *   tenant_id?: string,
 *   customer_id?: string,
 *   service_id?: string,
 *   staff_id?: string,
 *   start_at: string,
 *   end_at: string,
 *   status?: 'pending' | 'confirmed' | 'cancelled'
 * }
 */

interface ReservationPayload {
  tenant_id?: string;
  customer_id?: string;
  service_id?: string;
  staff_id?: string;
  start_at: string;
  end_at: string;
  status?: 'pending' | 'confirmed' | 'cancelled';
}

export const GET = createHttpHandler(
  async (ctx) => {
    const { page, limit, offset } = getPaginationParams(ctx);
    const url = new URL(ctx.request.url);
    const tenantId = url.searchParams.get('tenant_id') || ctx.user!.tenantId;

    let query = ctx.supabase
      .from('reservations')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('start_at', { ascending: true })
      .range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) throw ApiErrorFactory.databaseError(error);

    const { count } = await ctx.supabase
      .from('reservations')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    return {
      data: data || [],
      pagination: { page, limit, total: count || 0, offset }
    };
  },
  'GET',
  { auth: true }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const body = await parseJsonBody<ReservationPayload>(ctx.request);

    // Validate required fields
    if (!body.start_at || !body.end_at) {
      throw ApiErrorFactory.validationError({
        start_at: body.start_at ? undefined : 'start_at is required',
        end_at: body.end_at ? undefined : 'end_at is required'
      });
    }

    const payload = {
      tenant_id: body.tenant_id || ctx.user!.tenantId,
      customer_id: body.customer_id,
      service_id: body.service_id,
      staff_id: body.staff_id,
      start_at: body.start_at,
      end_at: body.end_at,
      status: body.status || 'pending'
    };

    const { data, error } = await ctx.supabase
      .from('reservations')
      .insert([payload])
      .select();

    if (error) throw ApiErrorFactory.databaseError(error);

    const row = Array.isArray(data) ? data[0] : data;
    return row;
  },
  'POST',
  { auth: true }
);
