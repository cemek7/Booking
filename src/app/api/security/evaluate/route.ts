import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import SecurityAutomationService from '@/lib/securityAutomation';

/**
 * POST /api/security/evaluate
 * Evaluate security rules - Requires owner/superadmin auth
 */
export const POST = createHttpHandler(
  async (ctx) => {
    // Auth check handled by handler (owner/superadmin required)
    const securityService = new SecurityAutomationService(ctx.supabase);

    // Log security action
    await securityService.logSecurityEvent({
      user_id: ctx.user?.id || 'unknown',
      action: 'security_rules_evaluation',
      resource_type: 'security_rules',
      success: true,
      ip_address: ctx.request.headers.get('x-forwarded-for') || 'unknown',
      user_agent: ctx.request.headers.get('user-agent') || 'unknown',
    });

    // Evaluate security rules
    const result = await securityService.evaluateSecurityRules();

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
 * GET /api/security/evaluate
 * Generate compliance report - Requires owner/superadmin auth
 */
export const GET = createHttpHandler(
  async (ctx) => {
    // Auth check handled by handler (owner/superadmin required)
    const securityService = new SecurityAutomationService(ctx.supabase);

    // Generate compliance report
    const result = await securityService.generateComplianceReport();
    
    if (!result.success) {
      throw ApiErrorFactory.internalError(
        result.error || 'Failed to generate compliance report',
        'COMPLIANCE_REPORT_FAILED'
      );
    }

    return {
      success: true,
      report: result.report,
      generated_at: new Date().toISOString(),
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'superadmin'] }
);