import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import SecurityAutomationService from '@/lib/securityAutomation';

/**
 * POST /api/security/pii
 * Perform PII data scan - Requires owner/superadmin auth
 */
export const POST = createHttpHandler(
  async (ctx) => {
    // Auth check handled by handler (owner/superadmin required)
    const securityService = new SecurityAutomationService(ctx.supabase);

    // Log PII scan action
    await securityService.logSecurityEvent({
      user_id: ctx.user?.id || 'unknown',
      action: 'pii_data_scan',
      resource_type: 'database_schema',
      success: true,
      sensitive_data_accessed: true,
      ip_address: ctx.request.headers.get('x-forwarded-for') || 'unknown',
      user_agent: ctx.request.headers.get('user-agent') || 'unknown',
    });

    // Perform PII scan
    const result = await securityService.scanPIIData();

    return {
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    };
  },
  'POST',
  { auth: true, roles: ['owner', 'superadmin'] }
);

/**
 * GET /api/security/pii
 * Retrieve PII data registry - Requires owner/superadmin auth
 */
export const GET = createHttpHandler(
  async (ctx) => {
    // Auth check handled by handler (owner/superadmin required)
    const piiRegistry = await ctx.supabase
      .from('pii_data_registry')
      .select('*')
      .order('table_name', { ascending: true })
      .order('column_name', { ascending: true });

    if (piiRegistry.error) {
      throw ApiErrorFactory.internalError(
        piiRegistry.error.message,
        'PII_REGISTRY_FETCH_FAILED'
      );
    }

    return {
      success: true,
      pii_registry: piiRegistry.data || [],
      total_entries: (piiRegistry.data || []).length,
      timestamp: new Date().toISOString(),
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'superadmin'] }
);