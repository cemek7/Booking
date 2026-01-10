import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { findFreeSlot } from '@/lib/scheduler';
import { NextResponse } from 'next/server';

interface FindFreeSlotPayload {
  tenant_id: string;
  from: string;
  to: string;
  duration_minutes?: number;
}

/**
 * POST /api/scheduler/find-free-slot
 * Find available time slots for a tenant within a date range.
 * Requires authentication.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const { from: fromIso, to: toIso, duration_minutes }: FindFreeSlotPayload = await ctx.request.json();

    if (!fromIso || !toIso) {
      throw ApiErrorFactory.badRequest('from and to ISO timestamps are required');
    }

    const durationMinutes = duration_minutes ? Number(duration_minutes) : 60;

    // Find available slot
    const slot = await findFreeSlot(ctx.supabase, tenantId, fromIso, toIso, durationMinutes);

    if (!slot) {
      throw ApiErrorFactory.notFound('No available slot found matching the criteria.');
    }

    return { data: slot };
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
