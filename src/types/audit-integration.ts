/**
 * Audit Integration for Unified Permission System
 * 
 * This module integrates the audit logging system with the unified permission
 * checker to provide comprehensive audit trails for all permission checks.
 */

import {
  UnifiedPermissionChecker,
  type UnifiedUser,
  type UnifiedPermissionContext,
  type UnifiedAccessResult
} from './unified-permissions';
import {
  unifiedAuth,
  requireAuth,
  requirePermission,
  requireRole,
  type UnifiedAuthResult,
  type UnifiedAuthOptions
} from './unified-auth';
import {
  AuditLogger,
  initializeAuditLogger,
  getAuditLogger,
  type AuditEvent
} from './audit-logging';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

// ============================================================================
// AUDITED PERMISSION CHECKER
// ============================================================================

/**
 * Permission checker with integrated audit logging
 * Wraps the unified permission checker to automatically log all checks
 */
export class AuditedPermissionChecker extends UnifiedPermissionChecker {
  private auditLogger: AuditLogger;

  constructor(supabase: SupabaseClient, auditLogger?: AuditLogger) {
    super(supabase);
    this.auditLogger = auditLogger || getAuditLogger();
  }

  /**
   * Check access with automatic audit logging
   */
  async checkAccess(
    userId: string,
    permission: string,
    context: UnifiedPermissionContext
  ): Promise<UnifiedAccessResult> {
    const startTime = Date.now();

    try {
      // Perform the original permission check
      const result = await super.checkAccess(userId, permission, context);
      
      // Get user details for audit logging
      const user = result.user || await this.getUserProfile(userId, context.tenantId);

      if (user) {
        // Log the permission check
        await this.auditLogger.logPermissionCheck(
          user,
          permission,
          context,
          result,
          {
            checkDuration: Date.now() - startTime,
            requestId: context.requestId
          }
        );

        // Log security violations if any
        if (!result.granted && result.securityLevel === 'critical') {
          await this.auditLogger.logSecurityViolation(
            userId,
            'critical_permission_denial',
            result.reason || 'Critical permission denied',
            {
              ...context,
              attemptedPermission: permission,
              securityLevel: result.securityLevel
            }
          );
        }

        // Log privilege escalation attempts
        if (this.isPrivilegeEscalationAttempt(user, permission)) {
          await this.auditLogger.logSecurityViolation(
            userId,
            'privilege_escalation_attempt',
            `User with role ${user.role} attempted to access ${permission}`,
            {
              ...context,
              attemptedPermission: permission,
              suspiciousPatterns: ['privilege_escalation']
            }
          );
        }

        // Log cross-tenant access attempts
        if (this.isCrossTenantAccess(user, context)) {
          await this.auditLogger.logSecurityViolation(
            userId,
            'cross_tenant_access_attempt',
            `User from tenant ${user.tenantId} attempted to access tenant ${context.targetTenantId}`,
            {
              ...context,
              suspiciousPatterns: ['cross_tenant_access']
            }
          );
        }
      }

      return result;

    } catch (error) {
      // Log permission check errors
      await this.auditLogger.logSecurityViolation(
        userId,
        'permission_check_error',
        `Permission check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {
          ...context,
          attemptedPermission: permission
        }
      );

      throw error;
    }
  }

  /**
   * Audit a role change
   */
  async auditRoleChange(
    adminUserId: string,
    targetUserId: string,
    oldRole: string,
    newRole: string,
    tenantId: string,
    justification?: string
  ): Promise<void> {
    const adminUser = await this.getUserProfile(adminUserId, tenantId);
    
    if (adminUser) {
      await this.auditLogger.logRoleChange(
        adminUser,
        targetUserId,
import { Role } from './roles';
import { assertRole } from './type-safe-rbac';

        oldRole: assertRole(oldRole, 'role change audit'),
        newRole: assertRole(newRole, 'role change audit'),
        tenantId,
        justification,
        {
          timestamp: new Date().toISOString(),
          adminUserId
        }
      );
    }
  }

  // Private helper methods
  private isPrivilegeEscalationAttempt(user: UnifiedUser, permission: string): boolean {
    const highPrivilegePermissions = [
      'system:manage:all',
      'admin:action',
      'tenant:delete:all',
      'user:manage:all'
    ];

    return (
      !user.isSuperAdmin &&
      user.role !== 'owner' &&
      highPrivilegePermissions.some(p => permission.includes(p))
    );
  }

  private isCrossTenantAccess(user: UnifiedUser, context: UnifiedPermissionContext): boolean {
    return (
      !user.isSuperAdmin &&
      context.targetTenantId &&
      context.targetTenantId !== user.tenantId
    );
  }
}

// ============================================================================
// AUDITED AUTH FUNCTIONS
// ============================================================================

/**
 * Enhanced unified auth with automatic audit logging
 */
export async function auditedUnifiedAuth(
  request: NextRequest,
  options: UnifiedAuthOptions = {}
): Promise<UnifiedAuthResult> {
  const auditLogger = getAuditLogger();
  
  // Extract request context for audit logging
  const requestContext = extractRequestContext(request);
  
  try {
    // Perform authentication
    const authResult = await unifiedAuth(request, options);
    
    // Log authentication event
    if (authResult.user) {
      const permissionContext: UnifiedPermissionContext = {
        userId: authResult.user.id,
        tenantId: authResult.user.tenantId,
        ...requestContext,
        requestId: generateRequestId()
      };

      await auditLogger.logPermissionCheck(
        authResult.user,
        'authentication',
        permissionContext,
        {
          granted: authResult.success,
          reason: authResult.error,
          appliedRules: ['authentication_check'],
          securityLevel: authResult.success ? 'low' : 'medium',
          auditRequired: !authResult.success
        },
        {
          authMethod: 'unified_auth',
          requiredRoles: options.requiredRoles,
          requiredPermissions: options.requiredPermissions
        }
      );
    }

    // Log failed authentication
    if (!authResult.success) {
      await auditLogger.logSecurityViolation(
        'unknown',
        'authentication_failure',
        authResult.error || 'Authentication failed',
        {
          ...requestContext,
          requestId: generateRequestId()
        }
      );
    }

    return authResult;

  } catch (error) {
    // Log authentication errors
    await auditLogger.logSecurityViolation(
      'unknown',
      'authentication_error',
      `Authentication system error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      {
        ...requestContext,
        requestId: generateRequestId()
      }
    );

    throw error;
  }
}

/**
 * Enhanced require auth with audit logging
 */
export async function auditedRequireAuth(request: NextRequest): Promise<UnifiedAuthResult> {
  return auditedUnifiedAuth(request);
}

/**
 * Enhanced require permission with audit logging
 */
export async function auditedRequirePermission(
  request: NextRequest,
  permission: string,
  context?: Record<string, any>
): Promise<UnifiedAuthResult> {
  return auditedUnifiedAuth(request, {
    requiredPermissions: [permission],
    context
  });
}

/**
 * Enhanced require role with audit logging
 */
export async function auditedRequireRole(
  request: NextRequest,
  roles: Role | Role[],
  allowSuperAdmin: boolean = true
): Promise<UnifiedAuthResult> {
  const requiredRoles = Array.isArray(roles) ? roles : [roles];
  return auditedUnifiedAuth(request, {
    requiredRoles: Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles],
    allowSuperAdmin
  });
}

// ============================================================================
// AUDIT MIDDLEWARE
// ============================================================================

/**
 * Express/Next.js middleware for automatic audit logging
 */
export function createAuditMiddleware(options: {
  logAllRequests?: boolean;
  logFailedOnly?: boolean;
  excludePaths?: string[];
  sensitiveDataFields?: string[];
} = {}) {
  const {
    logAllRequests = false,
    logFailedOnly = false,
    excludePaths = ['/health', '/metrics'],
    sensitiveDataFields = ['password', 'token', 'secret']
  } = options;

  return async function auditMiddleware(
    request: NextRequest,
    response?: Response
  ) {
    const auditLogger = getAuditLogger();
    const requestContext = extractRequestContext(request);
    
    // Skip excluded paths
    const pathname = new URL(request.url).pathname;
    if (excludePaths.some(path => pathname.startsWith(path))) {
      return;
    }

    const requestId = generateRequestId();
    const startTime = Date.now();

    try {
      // Log request if configured
      if (logAllRequests) {
        await auditLogger.logAdminAction(
          {
            id: 'system',
            role: 'superadmin' as Role,
            tenantId: '',
            isSuperAdmin: true,
            permissions: [],
            effectivePermissions: []
          },
          'http_request',
          `${request.method} ${pathname}`,
          'success',
          {
            ...requestContext,
            requestId,
            method: request.method
          }
        );
      }

      // Response will be handled by the actual auth functions

    } catch (error) {
      // Log middleware errors
      await auditLogger.logSecurityViolation(
        'system',
        'middleware_error',
        `Audit middleware error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {
          ...requestContext,
          requestId
        }
      );
    }
  };
}

// ============================================================================
// AUDIT REPORTING UTILITIES
// ============================================================================

/**
 * Generate comprehensive audit report for a tenant
 */
export async function generateTenantAuditReport(
  tenantId: string,
  startDate: Date,
  endDate: Date,
  options: {
    includeUserActivity?: boolean;
    includeSecurityEvents?: boolean;
    includeComplianceData?: boolean;
    format?: 'json' | 'csv' | 'pdf';
  } = {}
): Promise<{
  summary: any;
  details: AuditEvent[];
  exportUrl?: string;
}> {
  const auditLogger = getAuditLogger();
  
  const {
    includeUserActivity = true,
    includeSecurityEvents = true,
    includeComplianceData = true,
    format = 'json'
  } = options;

  // Get audit logs for the period
  const auditQuery = await auditLogger.queryAuditLogs({
    tenantId,
    startDate,
    endDate,
    limit: 10000
  });

  // Generate summary
  const summary = {
    period: {
      start: startDate.toISOString(),
      end: endDate.toISOString()
    },
    tenant: tenantId,
    totalEvents: auditQuery.total,
    eventBreakdown: {} as Record<string, number>,
    securityMetrics: {} as Record<string, number>,
    userActivity: {} as Record<string, number>,
    complianceStatus: {} as Record<string, number>
  };

  // Process events for summary
  auditQuery.logs.forEach(log => {
    // Event type breakdown
    summary.eventBreakdown[log.eventType] = 
      (summary.eventBreakdown[log.eventType] || 0) + 1;

    // Security metrics
    if (includeSecurityEvents) {
      summary.securityMetrics[log.securityLevel] = 
        (summary.securityMetrics[log.securityLevel] || 0) + 1;
    }

    // User activity
    if (includeUserActivity) {
      summary.userActivity[log.userRole] = 
        (summary.userActivity[log.userRole] || 0) + 1;
    }

    // Compliance flags
    if (includeComplianceData) {
      log.complianceFlags.forEach(flag => {
        summary.complianceStatus[flag] = 
          (summary.complianceStatus[flag] || 0) + 1;
      });
    }
  });

  return {
    summary,
    details: auditQuery.logs
  };
}

/**
 * Get real-time security dashboard data
 */
export async function getSecurityDashboard(tenantId: string): Promise<{
  alerts: AuditEvent[];
  metrics: {
    last24Hours: any;
    last7Days: any;
    trends: any;
  };
  recommendations: string[];
}> {
  const auditLogger = getAuditLogger();
  const now = new Date();
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Get recent critical events
  const alerts = await auditLogger.queryAuditLogs({
    tenantId,
    startDate: last24Hours,
    securityLevel: 'critical',
    limit: 50
  });

  // Get metrics
  const analytics = await auditLogger.generateSecurityAnalytics(tenantId, 7);

  return {
    alerts: alerts.logs,
    metrics: {
      last24Hours: analytics.metrics,
      last7Days: analytics,
      trends: analytics.trends
    },
    recommendations: analytics.recommendations
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function extractRequestContext(request: NextRequest): {
  ipAddress?: string;
  userAgent?: string;
  path: string;
  method: string;
} {
  return {
    ipAddress: request.ip || request.headers.get('x-forwarded-for') || 'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown',
    path: new URL(request.url).pathname,
    method: request.method
  };
}

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Initialize audit integration system
 */
export async function initializeAuditIntegration(
  supabase: SupabaseClient,
  options: {
    bufferSize?: number;
    flushInterval?: number;
    enableRealTimeAlerts?: boolean;
  } = {}
): Promise<{
  auditLogger: AuditLogger;
  auditedChecker: AuditedPermissionChecker;
}> {
  // Initialize audit logger
  const auditLogger = initializeAuditLogger(supabase, {
    bufferSize: options.bufferSize,
    flushInterval: options.flushInterval
  });

  // Create audited permission checker
  const auditedChecker = new AuditedPermissionChecker(supabase, auditLogger);

  // Set up real-time alerts if enabled
  if (options.enableRealTimeAlerts) {
    await setupRealTimeAlerts(supabase);
  }

  return {
    auditLogger,
    auditedChecker
  };
}

async function setupRealTimeAlerts(supabase: SupabaseClient): Promise<void> {
  // Set up Supabase real-time subscription for critical security events
  supabase
    .channel('critical_security_events')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'audit_logs',
        filter: "security_level=eq.critical"
      },
      (payload) => {
        console.warn('🚨 CRITICAL SECURITY EVENT:', payload.new);
        // Additional alert logic here (email, Slack, etc.)
      }
    )
    .subscribe();
}

// Export all functions and classes
export {
  AuditedPermissionChecker,
  auditedUnifiedAuth,
  auditedRequireAuth,
  auditedRequirePermission,
  auditedRequireRole,
  createAuditMiddleware,
  generateTenantAuditReport,
  getSecurityDashboard,
  initializeAuditIntegration
};