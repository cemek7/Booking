export const dynamic = 'force-dynamic';

import { z } from 'zod';

import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

const QuerySchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  service_id: z.string().optional(),
  staff_id: z.string().optional(),
});

type ConsumptionRow = {
  service_id?: string | null;
  staff_id?: string | null;
  planned_quantity?: number | null;
  actual_quantity?: number | null;
};

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const admin = createSupabaseAdminClient();
    const url = new URL(ctx.request.url);
    const parsed = QuerySchema.safeParse({
      start: url.searchParams.get('start'),
      end: url.searchParams.get('end'),
      service_id: url.searchParams.get('service_id') ?? undefined,
      staff_id: url.searchParams.get('staff_id') ?? undefined,
    });

    if (!parsed.success) {
      throw ApiErrorFactory.validationError({ issues: parsed.error.issues });
    }

    let query = admin
      .from('service_consumption_records')
      .select('id, service_id, staff_id, product_id, planned_quantity, actual_quantity, uom, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', parsed.data.start)
      .lte('created_at', parsed.data.end);

    if (parsed.data.service_id) {
      query = query.eq('service_id', parsed.data.service_id);
    }

    if (parsed.data.staff_id) {
      query = query.eq('staff_id', parsed.data.staff_id);
    }

    const { data, error } = await query;
    if (error) throw ApiErrorFactory.databaseError(error);

    const grouped = new Map<string, { service_id: string | null; staff_id: string | null; planned_quantity: number; actual_quantity: number; variance_quantity: number; records_count: number }>();

    for (const row of (data ?? []) as ConsumptionRow[]) {
      const key = `${row.service_id ?? 'none'}|${row.staff_id ?? 'none'}`;
      const planned = Number(row.planned_quantity ?? 0);
      const actual = Number(row.actual_quantity ?? planned);
      const entry = grouped.get(key) ?? {
        service_id: row.service_id ?? null,
        staff_id: row.staff_id ?? null,
        planned_quantity: 0,
        actual_quantity: 0,
        variance_quantity: 0,
        records_count: 0,
      };

      entry.planned_quantity += planned;
      entry.actual_quantity += actual;
      entry.variance_quantity += actual - planned;
      entry.records_count += 1;
      grouped.set(key, entry);
    }

    return {
      totals: Array.from(grouped.values()),
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'], permissions: [BOOKA_PERMISSIONS.MANAGE_PRODUCTS] },
);
