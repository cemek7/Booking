export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { getPaginationParams } from '@/lib/error-handling/migration-helpers';

const ReservationCreateSchema = z.object({
  customer_id: z.string().optional(),
  service_id: z.string().optional(),
  staff_id: z.string().optional(),
  start_at: z.string().min(1, 'start_at is required'),
  end_at: z.string().min(1, 'end_at is required'),
  status: z.enum(['pending', 'confirmed', 'cancelled']).optional(),
});

/**
 * GET,POST /api/reservations
 *
 * GET: Fetch reservations for the authenticated user's tenant.
 * POST: Create a new reservation in the authenticated user's tenant.
 *
 * POST Body: {
 *   customer_id?: string,
 *   service_id?: string,
 *   staff_id?: string,
 *   start_at: string,
 *   end_at: string,
 *   status?: 'pending' | 'confirmed' | 'cancelled'
 * }
 */

interface ReservationPayload {
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
    const tenantId = ctx.user!.tenantId;

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
    const rawBody = await parseJsonBody<ReservationPayload>(ctx.request);
    const parsed = ReservationCreateSchema.safeParse(rawBody);
    if (!parsed.success) {
      const fields = Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.'), i.message]));
      throw ApiErrorFactory.validationError(fields);
    }
    const body = parsed.data;

    if (body.customer_id) {
      const { data: c } = await ctx.supabase.from('customers')
        .select('id').eq('id', body.customer_id).eq('tenant_id', ctx.user!.tenantId).maybeSingle();
      if (!c) throw ApiErrorFactory.validationError({ customer_id: 'Not found in this tenant' });
    }
    if (body.service_id) {
      const { data: s } = await ctx.supabase.from('services')
        .select('id').eq('id', body.service_id).eq('tenant_id', ctx.user!.tenantId).maybeSingle();
      if (!s) throw ApiErrorFactory.validationError({ service_id: 'Not found in this tenant' });
    }
    if (body.staff_id) {
      // staff_id must be a non-owner tenant member (staff or manager); owners aren't bookable staff.
      const { data: st } = await ctx.supabase.from('tenant_users')
        .select('user_id, role').eq('user_id', body.staff_id).eq('tenant_id', ctx.user!.tenantId).maybeSingle();
      if (!st) throw ApiErrorFactory.validationError({ staff_id: 'Not found in this tenant' });
      if (st.role === 'owner') throw ApiErrorFactory.validationError({ staff_id: 'Owner cannot be assigned as booking staff' });
    }

    const payload = {
      tenant_id: ctx.user!.tenantId,
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
