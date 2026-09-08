export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getPlatformAlerts } from '@/lib/billing/platformAlerts';

/**
 * Platform-level warnings for the superadmin dashboard.
 *
 * Superadmin only: these describe Booka's own cost base and Meta account, not
 * any tenant's data.
 */
export const GET = createHttpHandler(
  async () => {
    const alerts = await getPlatformAlerts(createSupabaseAdminClient());
    return {
      success: true,
      alerts,
      criticalCount: alerts.filter((a) => a.severity === 'critical').length,
    };
  },
  'GET',
  { auth: true, roles: ['superadmin'], requireTenantMembership: false }
);
