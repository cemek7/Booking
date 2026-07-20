export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHttpHandler, getRouteParam, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { getAnomaly, updateAnomaly } from '@/lib/anomalies/service';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

const PatchSchema = z.object({
  assigned_to: z.string().uuid().nullable().optional(),
  status: z.enum(['open', 'investigating', 'resolved', 'dismissed', 'false_positive']).optional(),
  resolution_note: z.string().trim().max(1000).nullable().optional(),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const anomalyId = getRouteParam(ctx.params, 'id');
    const anomaly = await getAnomaly(ctx.supabase, tenantId, anomalyId);
    return { anomaly };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'], permissions: [BOOKA_PERMISSIONS.APPROVE_ANOMALIES] }
);

export const PATCH = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const anomalyId = getRouteParam(ctx.params, 'id');
    const body = (await ctx.request.json().catch(() => ({}))) as unknown;
    const parsed = PatchSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiErrorFactory.validationError({ issues: parsed.error.issues });
    }

    const anomaly = await updateAnomaly(ctx.supabase, tenantId, anomalyId, ctx.user?.id ?? 'unknown', {
      assignedTo: parsed.data.assigned_to,
      status: parsed.data.status,
      resolutionNote: parsed.data.resolution_note ?? null,
    });

    return { anomaly };
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager'], permissions: [BOOKA_PERMISSIONS.APPROVE_ANOMALIES] }
);
