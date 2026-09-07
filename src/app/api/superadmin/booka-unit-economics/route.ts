export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { buildBookaUnitEconomics } from '@/lib/analytics/booka-unit-economics';

const MAX_WINDOW_MS = 366 * 24 * 60 * 60 * 1000;
const QuerySchema = z.object({
  start: z.string().datetime({ offset: true }).optional(),
  end: z.string().datetime({ offset: true }).optional(),
  tenant_id: z.string().trim().min(1).max(120).optional(),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const searchParams = new URL(ctx.request.url).searchParams;
    const parsed = QuerySchema.safeParse({
      start: searchParams.get('start') || undefined,
      end: searchParams.get('end') || undefined,
      tenant_id: searchParams.get('tenant_id') || undefined,
    });
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }

    const now = new Date();
    const start = parsed.data.start
      ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const end = parsed.data.end ?? now.toISOString();
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (endMs <= startMs) {
      throw ApiErrorFactory.badRequest('end must be after start');
    }
    if (endMs - startMs > MAX_WINDOW_MS) {
      throw ApiErrorFactory.badRequest('Date range cannot exceed 366 days');
    }

    return buildBookaUnitEconomics(createSupabaseAdminClient(), {
      start,
      end,
      tenantId: parsed.data.tenant_id,
    });
  },
  'GET',
  { auth: true, roles: ['superadmin'], requireTenantMembership: false },
);
