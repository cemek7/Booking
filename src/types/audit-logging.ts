/**
 * Comprehensive Audit Logging System
 * 
 * This system provides complete audit logging for all permission checks, role changes,
 * and security events with compliance reporting and monitoring capabilities.
 * 
 * COMPLIANCE STANDARDS:
 * - SOX (Sarbanes-Oxley) - Financial data access tracking
 * - HIPAA - Healthcare data access logging
 * - GDPR - Personal data access audit trails
 * - ISO 27001 - Information security management
 * - PCI DSS - Payment card industry security
 */

import { createClientComponentClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from './roles';
import type { UnifiedUser, UnifiedPermissionContext, UnifiedAccessResult } from './unified-permissions';

// ============================================================================
// AUDIT LOG TYPES AND INTERFACES
// ============================================================================

export interface AuditEvent {
  id?: string;
  timestamp: string;
  eventType: AuditEventType;
  userId: string;
  userRole: Role;
  tenantId: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  resource: string;
  action: string;
  permission: string;
  context: AuditContext;
  result: AuditResult;
  securityLevel: 'low' | 'medium' | 'high' | 'critical';
  complianceFlags: ComplianceFlag[];
  metadata: Record<string, any>;
}

export type AuditEventType = 
  | 'permission_check'
  | 'role_change'
  | 'access_granted'
  | 'access_denied'
  | 'security_violation'
  | 'privilege_escalation'
  | 'cross_tenant_access'
  | 'admin_action'
  | 'system_modification'
  | 'data_access'
  | 'authentication_event';

export interface AuditContext {
  requestId?: string;
  operationType?: 'create' | 'read' | 'update' | 'delete' | 'execute';
  resourceType?: string;
  resourceId?: string;
  targetUserId?: string;
  targetTenantId?: string;
  dataCategory?: 'personal' | 'financial' | 'medical' | 'system' | 'public';
  sensitivityLevel?: 'public' | 'internal' | 'confidential' | 'restricted';
  geolocation?: {
    country: string;
    region?: string;
    city?: string;
  };
  deviceInfo?: {
    type: string;
    os?: string;
    browser?: string;
  };
}

export interface AuditResult {
  status: 'success' | 'failure' | 'blocked' | 'error';
  reason?: string;
  appliedRules: string[];
  securityScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresReview: boolean;
  automaticBlocking?: boolean;
}

export type ComplianceFlag = 
  | 'sox_financial'
  | 'hipaa_medical'
  | 'gdpr_personal'
  | 'pci_payment'
  | 'iso27001_security'
  | 'regulatory_reporting';

// ============================================================================
// AUDIT LOGGER CLASS
// ============================================================================

export class AuditLogger {
  private supabase: SupabaseClient;
  private bufferSize: number;
  private flushInterval: number;
  private eventBuffer: AuditEvent[];
  private flushTimer: NodeJS.Timeout | null;

  constructor(supabase: SupabaseClient, options: {
    bufferSize?: number;
    flushInterval?: number;
  } = {}) {
    this.supabase = supabase;
    this.bufferSize = options.bufferSize || 100;
    this.flushInterval = options.flushInterval || 5000; // 5 seconds
    this.eventBuffer = [];
    this.flushTimer = null;
    
    this.startPeriodicFlush();
  }

  /**
   * Log a permission check event
   */
  async logPermissionCheck(
    user: UnifiedUser,
    permission: string,
    context: UnifiedPermissionContext,
    result: UnifiedAccessResult,
    additionalContext?: Record<string, any>
  ): Promise<void> {
    const auditEvent: AuditEvent = {
      timestamp: new Date().toISOString(),
      eventType: result.granted ? 'access_granted' : 'access_denied',
      userId: user.id,
      userRole: user.role,
      tenantId: user.tenantId,
      sessionId: context.sessionId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      resource: this.extractResource(context),
      action: permission,
      permission,
      context: this.sanitizeContext(context),
      result: {
        status: result.granted ? 'success' : 'failure',
        reason: result.reason,
        appliedRules: result.appliedRules,
        securityScore: this.calculateSecurityScore(user, permission, result),
        riskLevel: this.assessRiskLevel(user, permission, context, result),
        requiresReview: this.requiresManualReview(user, permission, context, result)
      },
      securityLevel: result.securityLevel,
      complianceFlags: this.determineComplianceFlags(permission, context),
      metadata: {
        ...additionalContext,
        auditVersion: '1.0',
        systemTimestamp: Date.now()
      }
    };

    await this.bufferEvent(auditEvent);

    // Immediate flush for critical security events
    if (this.isCriticalSecurityEvent(auditEvent)) {
      await this.flushBuffer();
      await this.alertSecurityTeam(auditEvent);
    }
  }

  /**
   * Log role change events
   */
  async logRoleChange(
    adminUser: UnifiedUser,
    targetUserId: string,
    oldRole: Role,
    newRole: Role,
    tenantId: string,
    justification?: string,
    context?: Record<string, any>
  ): Promise<void> {
    const auditEvent: AuditEvent = {
      timestamp: new Date().toISOString(),
      eventType: 'role_change',
      userId: adminUser.id,
      userRole: adminUser.role,
      tenantId: adminUser.tenantId,
      resource: `user:${targetUserId}`,
      action: 'role_change',
      permission: 'user:manage:role',
      context: {
        targetUserId,
        targetTenantId: tenantId,
        operationType: 'update',
        resourceType: 'user_role'
      },
      result: {
        status: 'success',
        appliedRules: ['role_change_authorized'],
        securityScore: this.calculateRoleChangeSecurityScore(oldRole, newRole),
        riskLevel: this.assessRoleChangeRisk(oldRole, newRole),
        requiresReview: this.isPrivilegeEscalation(oldRole, newRole)
      },
      securityLevel: this.getSecurityLevelForRoleChange(oldRole, newRole),
      complianceFlags: ['sox_financial', 'iso27001_security'],
      metadata: {
        oldRole,
        newRole,
        justification: justification || 'No justification provided',
        ...context
      }
    };

    await this.bufferEvent(auditEvent);
    
    // Always flush role changes immediately
    await this.flushBuffer();
  }

  /**
   * Log security violations and suspicious activities
   */
  async logSecurityViolation(
    userId: string,
    violationType: string,
    details: string,
    context: UnifiedPermissionContext & {
      attemptedPermission?: string;
      suspiciousPatterns?: string[];
      threatScore?: number;
    }
  ): Promise<void> {
    const auditEvent: AuditEvent = {
      timestamp: new Date().toISOString(),
      eventType: 'security_violation',
      userId: userId || 'unknown',
      userRole: 'staff' as Role,
      tenantId: context.tenantId || 'unknown',
      sessionId: context.sessionId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      resource: context.targetUserId ? `user:${context.targetUserId}` : 'unknown',
      action: violationType,
      permission: context.attemptedPermission || 'unknown',
      context: this.sanitizeContext(context),
      result: {
        status: 'blocked',
        reason: details,
        appliedRules: ['security_violation_detected'],
        securityScore: 0,
        riskLevel: 'critical',
        requiresReview: true,
        automaticBlocking: true
      },
      securityLevel: 'critical',
      complianceFlags: ['iso27001_security'],
      metadata: {
        violationType,
        suspiciousPatterns: context.suspiciousPatterns,
        threatScore: context.threatScore,
        alertGenerated: true
      }
    };

    // Security violations are always flushed immediately
    await this.bufferEvent(auditEvent);
    await this.flushBuffer();
    await this.alertSecurityTeam(auditEvent);
  }

  /**
   * Log administrative actions
   */
  async logAdminAction(
    adminUser: UnifiedUser,
    action: string,
    target: string,
    result: 'success' | 'failure' | 'error',
    details?: Record<string, any>
  ): Promise<void> {
    const auditEvent: AuditEvent = {
      timestamp: new Date().toISOString(),
      eventType: 'admin_action',
      userId: adminUser.id,
      userRole: adminUser.role,
      tenantId: adminUser.tenantId,
      resource: target,
      action,
      permission: 'admin:action',
      context: {
        operationType: 'execute',
        resourceType: 'system'
      },
      result: {
        status: result,
        appliedRules: ['admin_action_authorized'],
        securityScore: adminUser.isSuperAdmin ? 100 : 75,
        riskLevel: 'high',
        requiresReview: !adminUser.isSuperAdmin
      },
      securityLevel: 'high',
      complianceFlags: ['sox_financial', 'iso27001_security'],
      metadata: details || {}
    };

    await this.bufferEvent(auditEvent);
    await this.flushBuffer(); // Admin actions are always flushed immediately
  }

  // ============================================================================
  // AUDIT QUERY AND REPORTING
  // ============================================================================

  /**
   * Query audit logs with filters
   */
  async queryAuditLogs(filters: {
    startDate?: Date;
    endDate?: Date;
    userId?: string;
    tenantId?: string;
    eventType?: AuditEventType;
    securityLevel?: string;
    complianceFlag?: ComplianceFlag;
    limit?: number;
    offset?: number;
  }): Promise<{
    logs: AuditEvent[];
    total: number;
    hasMore: boolean;
  }> {
    const { 
      startDate, 
      endDate, 
      userId, 
      tenantId, 
      eventType, 
      securityLevel, 
      complianceFlag,
      limit = 100,
      offset = 0
    } = filters;

    let query = this.supabase
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (startDate) {
      query = query.gte('timestamp', startDate.toISOString());
    }

    if (endDate) {
      query = query.lte('timestamp', endDate.toISOString());
    }

    if (userId) {
      query = query.eq('user_id', userId);
    }

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    if (eventType) {
      query = query.eq('event_type', eventType);
    }

    if (securityLevel) {
      query = query.eq('security_level', securityLevel);
    }

    if (complianceFlag) {
      query = query.contains('compliance_flags', [complianceFlag]);
    }

    const { data, count, error } = await query;

    if (error) {
      throw new Error(`Failed to query audit logs: ${error.message}`);
    }

    return {
      logs: (data || []).map(this.mapDatabaseToAuditEvent),
      total: count || 0,
      hasMore: count ? offset + limit < count : false
    };
  }

  /**
   * Generate compliance report
   */
  async generateComplianceReport(
    tenantId: string,
    complianceStandard: ComplianceFlag,
    startDate: Date,
    endDate: Date
  ): Promise<{
    summary: ComplianceReportSummary;
    violations: AuditEvent[];
    recommendations: string[];
    exportUrl?: string;
  }> {
    const logs = await this.queryAuditLogs({
      tenantId,
      complianceFlag: complianceStandard,
      startDate,
      endDate,
      limit: 10000
    });

    const summary: ComplianceReportSummary = {
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      standard: complianceStandard,
      totalEvents: logs.total,
      securityViolations: logs.logs.filter(log => log.eventType === 'security_violation').length,
      highRiskEvents: logs.logs.filter(log => log.result.riskLevel === 'high' || log.result.riskLevel === 'critical').length,
      failedAccessAttempts: logs.logs.filter(log => log.result.status === 'failure').length,
      privilegeEscalations: logs.logs.filter(log => log.eventType === 'privilege_escalation').length,
      complianceScore: this.calculateComplianceScore(logs.logs, complianceStandard)
    };

    const violations = logs.logs.filter(log => 
      log.eventType === 'security_violation' || 
      log.result.riskLevel === 'critical' ||
      log.result.requiresReview
    );

    const recommendations = this.generateComplianceRecommendations(summary, violations);

    return {
      summary,
      violations,
      recommendations
    };
  }

  /**
   * Generate security analytics
   */
  async generateSecurityAnalytics(tenantId: string, days: number = 30): Promise<SecurityAnalytics> {
    const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
    const endDate = new Date();

    const logs = await this.queryAuditLogs({
      tenantId,
      startDate,
      endDate,
      limit: 10000
    });

    return {
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        days
      },
      metrics: {
        totalEvents: logs.total,
        successfulAccess: logs.logs.filter(log => log.result.status === 'success').length,
        failedAccess: logs.logs.filter(log => log.result.status === 'failure').length,
        blockedAccess: logs.logs.filter(log => log.result.status === 'blocked').length,
        securityViolations: logs.logs.filter(log => log.eventType === 'security_violation').length,
        uniqueUsers: new Set(logs.logs.map(log => log.userId)).size,
        uniqueIPs: new Set(logs.logs.map(log => log.ipAddress).filter(Boolean)).size
      },
      trends: this.calculateSecurityTrends(logs.logs, days),
      topRisks: this.identifyTopSecurityRisks(logs.logs),
      recommendations: this.generateSecurityRecommendations(logs.logs)
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private async bufferEvent(event: AuditEvent): Promise<void> {
    this.eventBuffer.push(event);

    if (this.eventBuffer.length >= this.bufferSize) {
      await this.flushBuffer();
    }
  }

  private async flushBuffer(): Promise<void> {
    if (this.eventBuffer.length === 0) return;

    const eventsToFlush = [...this.eventBuffer];
    this.eventBuffer = [];

    try {
      const { error } = await this.supabase
        .from('audit_logs')
        .insert(eventsToFlush.map(this.mapAuditEventToDatabase));

      if (error) {
        console.error('Failed to write audit logs:', error);
        // Re-add events to buffer for retry
        this.eventBuffer.unshift(...eventsToFlush);
      }
    } catch (error) {
      console.error('Audit log write error:', error);
      // Re-add events to buffer for retry
      this.eventBuffer.unshift(...eventsToFlush);
    }
  }

  private startPeriodicFlush(): void {
    this.flushTimer = setInterval(async () => {
      await this.flushBuffer();
    }, this.flushInterval);
  }

  private sanitizeContext(context: UnifiedPermissionContext): AuditContext {
    // Remove sensitive information from context before logging
    const sanitized = { ...context };
    
    // Remove potential sensitive fields
    delete sanitized.password;
    delete sanitized.token;
    delete sanitized.secret;
    delete sanitized.creditCard;
    delete sanitized.ssn;

    return sanitized;
  }

  private extractResource(context: UnifiedPermissionContext): string {
    if (context.targetUserId) return `user:${context.targetUserId}`;
    if (context.resourceId) return `${context.resourceType || 'resource'}:${context.resourceId}`;
    return context.resourceType || 'unknown';
  }

  private calculateSecurityScore(
    user: UnifiedUser, 
    permission: string, 
    result: UnifiedAccessResult
  ): number {
    let score = 50; // Base score

    // Adjust based on user role
    if (user.isSuperAdmin) score += 30;
    else if (user.role === 'owner') score += 20;
    else if (user.role === 'manager') score += 10;

    // Adjust based on permission
    if (permission.includes('system:')) score += 20;
    else if (permission.includes('admin:')) score += 15;

    // Adjust based on result
    if (result.granted) score += 20;
    else score -= 30;

    return Math.max(0, Math.min(100, score));
  }

  private assessRiskLevel(
    user: UnifiedUser,
    permission: string,
    context: UnifiedPermissionContext,
    result: UnifiedAccessResult
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (!result.granted && permission.includes('system:')) return 'critical';
    if (context.targetTenantId && context.targetTenantId !== user.tenantId) return 'high';
    if (permission.includes('admin:') || permission.includes('system:')) return 'high';
    if (result.granted && user.role === 'staff') return 'medium';
    return 'low';
  }

  private requiresManualReview(
    user: UnifiedUser,
    permission: string,
    context: UnifiedPermissionContext,
    result: UnifiedAccessResult
  ): boolean {
    // Always review security violations
    if (!result.granted && result.securityLevel === 'critical') return true;
    
    // Review cross-tenant access
    if (context.targetTenantId && context.targetTenantId !== user.tenantId) return true;
    
    // Review system permissions for non-superadmin
    if (permission.includes('system:') && !user.isSuperAdmin) return true;
    
    return false;
  }

  private determineComplianceFlags(
    permission: string,
    context: UnifiedPermissionContext
  ): ComplianceFlag[] {
    const flags: ComplianceFlag[] = [];

    if (context.dataCategory === 'financial' || permission.includes('billing:')) {
      flags.push('sox_financial');
    }

    if (context.dataCategory === 'medical' || permission.includes('health:')) {
      flags.push('hipaa_medical');
    }

    if (context.dataCategory === 'personal' || permission.includes('profile:')) {
      flags.push('gdpr_personal');
    }

    if (permission.includes('payment:') || permission.includes('billing:')) {
      flags.push('pci_payment');
    }

    // Always flag security-related operations
    if (permission.includes('system:') || permission.includes('admin:')) {
      flags.push('iso27001_security');
    }

    return flags;
  }

  private isCriticalSecurityEvent(event: AuditEvent): boolean {
    return (
      event.eventType === 'security_violation' ||
      event.securityLevel === 'critical' ||
      event.result.riskLevel === 'critical' ||
      event.result.automaticBlocking === true
    );
  }

  private async alertSecurityTeam(event: AuditEvent): Promise<void> {
    // Implementation would send alerts to security team
    // This could be email, Slack, PagerDuty, etc.
    console.warn(`🚨 SECURITY ALERT: ${event.eventType}`, {
      userId: event.userId,
      action: event.action,
      reason: event.result.reason,
      timestamp: event.timestamp
    });
  }

  private calculateComplianceScore(logs: AuditEvent[], standard: ComplianceFlag): number {
    if (logs.length === 0) return 100;

    const violations = logs.filter(log => 
      log.eventType === 'security_violation' ||
      log.result.status === 'blocked' ||
      log.result.riskLevel === 'critical'
    ).length;

    const score = Math.max(0, 100 - (violations / logs.length) * 100);
    return Math.round(score);
  }

  private generateComplianceRecommendations(
    summary: ComplianceReportSummary,
    violations: AuditEvent[]
  ): string[] {
    const recommendations: string[] = [];

    if (summary.complianceScore < 80) {
      recommendations.push('Overall compliance score is below acceptable threshold (80%)');
    }

    if (summary.securityViolations > 0) {
      recommendations.push(`Address ${summary.securityViolations} security violations`);
    }

    if (summary.privilegeEscalations > 0) {
      recommendations.push('Review and validate all privilege escalation events');
    }

    if (summary.failedAccessAttempts > summary.totalEvents * 0.1) {
      recommendations.push('High rate of failed access attempts - review authentication mechanisms');
    }

    return recommendations;
  }

  private calculateSecurityTrends(logs: AuditEvent[], days: number): SecurityTrend[] {
    // Implementation would calculate daily trends
    return [];
  }

  private identifyTopSecurityRisks(logs: AuditEvent[]): SecurityRisk[] {
    // Implementation would analyze logs to identify top risks
    return [];
  }

  private generateSecurityRecommendations(logs: AuditEvent[]): string[] {
    // Implementation would generate security recommendations
    return [];
  }

  // Database mapping methods
  private mapAuditEventToDatabase(event: AuditEvent): any {
    return {
      timestamp: event.timestamp,
      event_type: event.eventType,
      user_id: event.userId,
      user_role: event.userRole,
      tenant_id: event.tenantId,
      session_id: event.sessionId,
      ip_address: event.ipAddress,
      user_agent: event.userAgent,
      resource: event.resource,
      action: event.action,
      permission: event.permission,
      context: event.context,
      result: event.result,
      security_level: event.securityLevel,
      compliance_flags: event.complianceFlags,
      metadata: event.metadata
    };
  }

  private mapDatabaseToAuditEvent(row: any): AuditEvent {
    return {
      id: row.id,
      timestamp: row.timestamp,
      eventType: row.event_type,
      userId: row.user_id,
      userRole: row.user_role,
      tenantId: row.tenant_id,
      sessionId: row.session_id,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      resource: row.resource,
      action: row.action,
      permission: row.permission,
      context: row.context,
      result: row.result,
      securityLevel: row.security_level,
      complianceFlags: row.compliance_flags,
      metadata: row.metadata
    };
  }

  private calculateRoleChangeSecurityScore(oldRole: Role, newRole: Role): number {
    // Implementation for role change security scoring
    return 75;
  }

  private assessRoleChangeRisk(oldRole: Role, newRole: Role): 'low' | 'medium' | 'high' | 'critical' {
    // Implementation for role change risk assessment
    return 'medium';
  }

  private isPrivilegeEscalation(oldRole: Role, newRole: Role): boolean {
    const roleHierarchy: Record<Role, number> = {
      'staff': 1,
      'manager': 2,
      'owner': 3,
      'superadmin': 4
    };

    return roleHierarchy[newRole] > roleHierarchy[oldRole];
  }

  private getSecurityLevelForRoleChange(oldRole: Role, newRole: Role): 'low' | 'medium' | 'high' | 'critical' {
    if (this.isPrivilegeEscalation(oldRole, newRole)) return 'high';
    return 'medium';
  }

  /**
   * Cleanup method to stop timers
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

// ============================================================================
// SUPPORTING TYPES
// ============================================================================

export interface ComplianceReportSummary {
  period: {
    start: string;
    end: string;
  };
  standard: ComplianceFlag;
  totalEvents: number;
  securityViolations: number;
  highRiskEvents: number;
  failedAccessAttempts: number;
  privilegeEscalations: number;
  complianceScore: number;
}

export interface SecurityAnalytics {
  period: {
    start: string;
    end: string;
    days: number;
  };
  metrics: {
    totalEvents: number;
    successfulAccess: number;
    failedAccess: number;
    blockedAccess: number;
    securityViolations: number;
    uniqueUsers: number;
    uniqueIPs: number;
  };
  trends: SecurityTrend[];
  topRisks: SecurityRisk[];
  recommendations: string[];
}

export interface SecurityTrend {
  date: string;
  totalEvents: number;
  violations: number;
  riskScore: number;
}

export interface SecurityRisk {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  occurrences: number;
  description: string;
  recommendation: string;
}

// ============================================================================
// GLOBAL AUDIT LOGGER INSTANCE
// ============================================================================

let globalAuditLogger: AuditLogger | null = null;

export function initializeAuditLogger(
  supabase: SupabaseClient,
  options?: { bufferSize?: number; flushInterval?: number }
): AuditLogger {
  globalAuditLogger = new AuditLogger(supabase, options);
  return globalAuditLogger;
}

export function getAuditLogger(): AuditLogger {
  if (!globalAuditLogger) {
    throw new Error('Audit logger not initialized. Call initializeAuditLogger() first.');
  }
  return globalAuditLogger;
}

// Export types and classes
export type {
  AuditEvent,
  AuditEventType,
  AuditContext,
  AuditResult,
  ComplianceFlag
};