import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { nextAvailableSlot } from '@/lib/scheduler';
import { NextResponse } from 'next/server';

interface NextAvailableSlotPayload {
  tenant_id: string;
  from: string;
  duration_minutes?: number;
  days_lookahead?: number;
}

/**
 * POST /api/scheduler/next-available
 * Find the next available time slot for a tenant within a lookahead period.
 * Requires authentication.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const {
      from,
      duration_minutes,
      days_lookahead,
    }: NextAvailableSlotPayload = await ctx.request.json();

    if (!from) {
      throw ApiErrorFactory.badRequest('from is required');
    }

    const durationMinutes = duration_minutes ? Number(duration_minutes) : 60;
    const daysLookahead = days_lookahead ? Number(days_lookahead) : 14;

    // Find next available slot
    const slot = await nextAvailableSlot(ctx.supabase, tenantId, from, durationMinutes, daysLookahead);

    if (!slot) {
      throw ApiErrorFactory.notFound('No available slot found within the given lookahead period.');
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
