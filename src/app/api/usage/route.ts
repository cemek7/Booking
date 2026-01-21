import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { ensureTenantHasQuota } from '@/lib/llmQuota';

const GetUsageQuerySchema = z.object({
  tenant_id: z.string().uuid('Invalid tenant ID'),
});

interface DailyUsage {
  bookings: number;
  deposits: number;
  llm_tokens: number;
}

/**
 * GET /api/usage?tenant_id=...
 * Returns trailing 7 days usage + quota status.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const queryValidation = GetUsageQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!queryValidation.success) {
      throw ApiErrorFactory.validationError({ issues: queryValidation.error.issues });
    }

    const { tenant_id: tenantId } = queryValidation.data;

    // Verify the caller has access to this tenant
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const startRange = new Date();
    startRange.setUTCDate(startRange.getUTCDate() - 6); // inclusive 7-day window
    startRange.setUTCHours(0, 0, 0, 0);
    const startIso = startRange.toISOString().substring(0, 10);

    const { data, error } = await ctx.supabase
      .from('usage_daily')
      .select('day, bookings, deposits, llm_tokens')
      .eq('tenant_id', tenantId)
      .gte('day', startIso)
      .order('day', { ascending: true });

    const quota = await ensureTenantHasQuota(ctx.supabase, tenantId);

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    // Normalize to ensure all days present
    const days: Record<string, DailyUsage> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(startRange.getTime());
      d.setUTCDate(startRange.getUTCDate() + i);
      const k = d.toISOString().substring(0, 10);
      days[k] = { bookings: 0, deposits: 0, llm_tokens: 0 };
    }

    (data || []).forEach(row => {
      if (row.day && days[row.day]) {
        days[row.day] = {
          bookings: row.bookings || 0,
          deposits: row.deposits || 0,
          llm_tokens: row.llm_tokens || 0,
        };
      }
    });

    return {
      window: Object.entries(days).map(([day, vals]) => ({ day, ...vals })),
      quota,
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);
