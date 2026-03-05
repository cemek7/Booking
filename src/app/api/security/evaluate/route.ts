import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import SecurityAutomationService from '@/lib/securityAutomation';

const assertSecurityAdminRole = (ctx: { user?: { role?: string } }) => {
  if (!ctx.user || !['owner', 'superadmin'].includes(ctx.user.role || '')) {
    throw ApiErrorFactory.forbidden('Insufficient role for security evaluation');
  }
};

/**
 * POST /api/security/evaluate
 * Evaluate security rules - Requires owner/superadmin auth
 */
export const POST = createHttpHandler(
  async (ctx) => {
    assertSecurityAdminRole(ctx);
    const securityService = new SecurityAutomationService(ctx.supabase);

    // Log security action
    await securityService.logSecurityEvent({
      user_id: ctx.user!.id,
      action: 'security_rules_evaluation',
      resource_type: 'security_rules',
      success: true,
      ip_address: ctx.request.headers.get('x-forwarded-for') || 'unknown',
      user_agent: ctx.request.headers.get('user-agent') || 'unknown',
    });

    // Evaluate security rules
    const result = await securityService.evaluateSecurityRules();

    if (!result.success) {
      throw ApiErrorFactory.internalServerError(new Error(result.error || 'Security rules evaluation failed'));
    }

    return { ...result,
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
    assertSecurityAdminRole(ctx);
    const securityService = new SecurityAutomationService(ctx.supabase);

    // Generate compliance report
    const result = await securityService.generateComplianceReport();
    
    if (!result.success) {
      throw ApiErrorFactory.internalServerError(new Error(result.error || 'Failed to generate compliance report'));
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