export const dynamic = 'force-dynamic';

import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { listAnomalies } from '@/lib/anomalies/service';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const url = new URL(ctx.request.url);

    const anomalies = await listAnomalies(ctx.supabase, tenantId, {
      status: url.searchParams.get('status') ?? undefined,
      severity: url.searchParams.get('severity') ?? undefined,
      domain: url.searchParams.get('domain') ?? undefined,
      assignedTo: url.searchParams.get('assigned_to') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    });

    return { anomalies };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'], permissions: [BOOKA_PERMISSIONS.APPROVE_ANOMALIES] }
);
