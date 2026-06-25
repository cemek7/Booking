export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { findFreeStaff } from '@/lib/optimizedScheduler';
import { NextResponse } from 'next/server';

const FindFreeStaffSchema = z.object({
  start_at: z.string().min(1, 'start_at is required'),
  end_at: z.string().min(1, 'end_at is required'),
});

/**
 * POST /api/scheduler/find-free-staff
 * Find available staff members for a tenant within a time range.
 * Requires authentication.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);

    const raw = await ctx.request.json();
    const parsed = FindFreeStaffSchema.safeParse(raw);
    if (!parsed.success) {
      const fields = Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.'), i.message]));
      throw ApiErrorFactory.validationError(fields);
    }
    const { start_at: startAt, end_at: endAt } = parsed.data;

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
