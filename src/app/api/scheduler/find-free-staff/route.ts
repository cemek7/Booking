import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { findFreeStaff } from '@/lib/scheduler';
import { NextResponse } from 'next/server';

interface FindFreeStaffPayload {
  tenant_id: string;
  start_at: string;
  end_at: string;
}

/**
 * POST /api/scheduler/find-free-staff
 * Find available staff members for a tenant within a time range.
 * Requires authentication.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const { start_at: startAt, end_at: endAt }: FindFreeStaffPayload = await ctx.request.json();

    if (!startAt || !endAt) {
      throw ApiErrorFactory.badRequest('start_at and end_at are required');
    }

    // Find available staff
    const staff = await findFreeStaff(ctx.supabase, tenantId, startAt, endAt);

    return { data: staff };
  },
  'POST',
  { auth: true }
);

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'POST, OPTIONS',
      'Content-Type': 'application/json',
    },
  });
}
