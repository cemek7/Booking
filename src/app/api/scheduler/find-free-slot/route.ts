export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { findFreeSlot } from '@/lib/optimizedScheduler';
import { NextResponse } from 'next/server';

const FindFreeSlotSchema = z.object({
  from: z.string().min(1, 'from ISO timestamp is required'),
  to: z.string().min(1, 'to ISO timestamp is required'),
  duration_minutes: z.number().positive().optional(),
});

/**
 * POST /api/scheduler/find-free-slot
 * Find available time slots for a tenant within a date range.
 * Requires authentication.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);

    const raw = await ctx.request.json();
    const parsed = FindFreeSlotSchema.safeParse(raw);
    if (!parsed.success) {
      const fields = Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.'), i.message]));
      throw ApiErrorFactory.validationError(fields);
    }
    const { from: fromIso, to: toIso, duration_minutes } = parsed.data;
    const durationMinutes = duration_minutes ?? 60;

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
