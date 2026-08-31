export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { buildRevenueFrontDeskReport } from '@/lib/analytics/revenue-front-desk-report';
import { getTenantCurrency } from '@/lib/tenant-currency';

const MAX_WINDOW_MS = 93 * 24 * 60 * 60 * 1000;

const QuerySchema = z.object({
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const searchParams = new URL(ctx.request.url).searchParams;
    const parsed = QuerySchema.safeParse({
      start: searchParams.get('start'),
      end: searchParams.get('end'),
    });
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }

    const startMs = Date.parse(parsed.data.start);
    const endMs = Date.parse(parsed.data.end);
    if (endMs <= startMs) {
      throw ApiErrorFactory.badRequest('end must be after start');
    }
    if (endMs - startMs > MAX_WINDOW_MS) {
      throw ApiErrorFactory.badRequest('Date range cannot exceed 93 days');
    }

    const tenantId = getVerifiedTenantId(ctx);
    const currency = await getTenantCurrency(ctx.supabase, tenantId, 'NGN');
    return buildRevenueFrontDeskReport(ctx.supabase, {
      tenantId,
      start: parsed.data.start,
      end: parsed.data.end,
      currency,
    });
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] },
);
