export const dynamic = 'force-dynamic';

import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import {
  RequestStatusSchema,
  RequestTypeSchema,
} from '@/lib/booka/revenue-intake';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const requestTypeValue = url.searchParams.get('request_type');
    const statusValue = url.searchParams.get('status');
    const requestType = requestTypeValue
      ? RequestTypeSchema.safeParse(requestTypeValue)
      : null;
    const status = statusValue ? RequestStatusSchema.safeParse(statusValue) : null;

    if (requestType && !requestType.success) {
      throw ApiErrorFactory.validationError({ request_type: 'Invalid request type' });
    }
    if (status && !status.success) {
      throw ApiErrorFactory.validationError({ status: 'Invalid request status' });
    }

    const page = Math.max(1, Number(url.searchParams.get('page') || '1') || 1);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || '50') || 50));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const admin = createSupabaseAdminClient();
    let query = admin
      .from('booka_revenue_requests')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (requestType?.success) query = query.eq('request_type', requestType.data);
    if (status?.success) query = query.eq('status', status.data);

    const { data, error, count } = await query.range(from, to);
    if (error) {
      throw ApiErrorFactory.databaseError(new Error(error.message));
    }

    return { data: data ?? [], total: count ?? 0 };
  },
  'GET',
  { auth: true, roles: ['superadmin'], requireTenantMembership: false },
);
