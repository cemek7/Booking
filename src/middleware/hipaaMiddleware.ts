/**
 * HIPAA Compliance Middleware
 * 
 * Automatically logs PHI access and enforces compliance policies
 * for all API routes that handle protected health information
 */

import { NextRequest, NextResponse } from 'next/server';
import { hipaaCompliance } from '@/lib/compliance/hipaaCompliance';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { observability } from '@/lib/observability/observability';

export interface HIPAAMiddlewareConfig {
  enabled: boolean;
  logAllAccess: boolean;
  requireJustification: boolean;
  allowedRoles: string[];
  sensitiveDataTypes: string[];
  maxAccessAttempts: number;
  sessionTimeout: number;
}

export interface PHIAccessContext {
  userId: string;
  tenantId: string;
  userRole: string;
  ipAddress: string;
  userAgent: string;
  sessionId: string;
  requestPath: string;
  method: string;
}

/**
 * HIPAA Compliance Middleware for automatic PHI access logging
 */
export class HIPAAMiddleware {
  private config: HIPAAMiddlewareConfig;
  private supabase = createSupabaseAdminClient();
  
  constructor(config: Partial<HIPAAMiddlewareConfig> = {}) {
    this.config = {
      enabled: true,
      logAllAccess: true,
      requireJustification: false,
      allowedRoles: ['owner', 'manager', 'staff', 'practitioner'],
      sensitiveDataTypes: ['medical_record', 'prescription', 'image', 'document'],
      maxAccessAttempts: 100,
      sessionTimeout: 30 * 60 * 1000, // 30 minutes
      ...config
    };
  }
  
  /**
   * Main middleware function to be used in Next.js middleware
   */
  async handle(request: NextRequest): Promise<NextResponse | null> {
    const span = observability.startTrace('hipaa.middleware.handle');
    
    try {
      if (!this.config.enabled) {
        return null; // Continue to next middleware
      }
      
      const context = await this.extractContext(request);
      if (!context) {
        return null; // Not a protected route or no valid session
      }
      
      // Check if this is a PHI-related request
      const isPHIRequest = this.isPHIRequest(request);
      if (!isPHIRequest) {
        return null; // Not a PHI request
      }
      
      // Validate access permissions
      const accessValidation = await this.validateAccess(context, request);
      if (!accessValidation.allowed) {
        return new NextResponse('Access Denied: ' + accessValidation.reason, { 
          status: 403 
        });
      }
      
      // Log PHI access if configured
      if (this.config.logAllAccess) {
        await this.logPHIAccess(context, request);
      }
      
      // Check for suspicious activity
      const suspiciousActivity = await this.detectSuspiciousActivity(context);
      if (suspiciousActivity.detected) {
        await this.handleSuspiciousActivity(context, suspiciousActivity);
      }
      
      observability.recordBusinessMetric('phi_request_processed_total', 1, {
        method: request.method,
        path: new URL(request.url).pathname,
        user_role: context.userRole
      });
      
      return null; // Continue to next middleware
      
    } catch (error) {
      console.error('HIPAA middleware error:', error);
      span.recordException(error as Error);
      
      // Log security incident
      await this.logSecurityIncident('MIDDLEWARE_ERROR', {
        error: error.message,
        request_url: request.url,
        ip_address: this.getClientIP(request)
      });
      
      return new NextResponse('Internal Server Error', { status: 500 });
    } finally {
      span.end();
    }
  }
  
  /**
   * Extract user and session context from request
   */
  private async extractContext(request: NextRequest): Promise<PHIAccessContext | null> {
    try {
      // Get user session (implementation depends on your auth system)
      const sessionToken = request.cookies.get('session-token')?.value;
      if (!sessionToken) {
        return null;
      }
      
      // Verify session and get user info
      const { data: { user }, error } = await this.supabase.auth.getUser(sessionToken);
      if (error || !user) {
        return null;
      }
      
      // Get user's tenant and role
      const { data: userTenantRole } = await this.supabase
        .from('user_tenant_roles')
        .select('tenant_id, role')
        .eq('user_id', user.id)
        .single();
      
      if (!userTenantRole) {
        return null;
      }
      
      return {
        userId: user.id,
        tenantId: userTenantRole.tenant_id,
        userRole: userTenantRole.role,
        ipAddress: this.getClientIP(request),
        userAgent: request.headers.get('user-agent') || '',
        sessionId: sessionToken,
        requestPath: new URL(request.url).pathname,
        method: request.method
      };
      
    } catch (error) {
      console.error('Error extracting context:', error);
      return null;
    }
  }
  
  /**
   * Determine if request involves PHI data
   */
  private isPHIRequest(request: NextRequest): boolean {
    const url = new URL(request.url);
    const path = url.pathname.toLowerCase();
    
    // PHI-related API endpoints
    const phiEndpoints = [
      '/api/patients',
      '/api/appointments',
      '/api/medical-records',
      '/api/prescriptions',
      '/api/documents',
      '/api/images'
    ];
    
    return phiEndpoints.some(endpoint => path.includes(endpoint));
  }
  
  /**
   * Validate user access permissions
   */
  private async validateAccess(
    context: PHIAccessContext, 
    request: NextRequest
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Check role permissions
    if (!this.config.allowedRoles.includes(context.userRole)) {
      return {
        allowed: false,
        reason: `Role ${context.userRole} not authorized for PHI access`
      };
    }
    
    // Check session timeout
    const sessionAge = Date.now() - new Date(context.sessionId).getTime();
    if (sessionAge > this.config.sessionTimeout) {
      return {
        allowed: false,
        reason: 'Session expired - please re-authenticate'
      };
    }
    
    // Check daily access limits
    const todayAccessCount = await this.getTodayAccessCount(context.userId, context.tenantId);
    if (todayAccessCount >= this.config.maxAccessAttempts) {
      return {
        allowed: false,
        reason: 'Daily PHI access limit exceeded'
      };
    }
    
    // Check for required justification
    if (this.config.requireJustification) {
      const justification = request.headers.get('x-phi-justification');
      if (!justification || justification.length < 10) {
        return {
          allowed: false,
          reason: 'PHI access justification required'
        };
      }
    }
    
    return { allowed: true };
  }
  
  /**
   * Log PHI access for audit trail
   */
  private async logPHIAccess(context: PHIAccessContext, request: NextRequest): Promise<void> {
    try {
      const url = new URL(request.url);
      const dataType = this.extractDataType(url.pathname);
      const action = this.mapMethodToAction(request.method);
      const justification = request.headers.get('x-phi-justification') || 'Automated access via API';
      
      await hipaaCompliance.logPHIAccess({
        user_id: context.userId,
        patient_id: this.extractPatientId(request),
        action,
        data_type: dataType,
        ip_address: context.ipAddress,
        user_agent: context.userAgent,
        justification,
        session_id: context.sessionId,
        tenant_id: context.tenantId
      });
      
    } catch (error) {
      console.error('Error logging PHI access:', error);
      // Don't block request for logging errors, but track them
      await this.logSecurityIncident('PHI_LOGGING_ERROR', {
        error: error.message,
        context: JSON.stringify(context)
      });
    }
  }
  
  /**
   * Detect suspicious access patterns
   */
  private async detectSuspiciousActivity(context: PHIAccessContext): Promise<{
    detected: boolean;
    type?: string;
    details?: any;
  }> {
    // Check for rapid sequential access
    const recentAccess = await this.getRecentAccess(context.userId, 5 * 60 * 1000); // Last 5 minutes
    if (recentAccess.length > 20) {
      return {
        detected: true,
        type: 'RAPID_ACCESS_PATTERN',
        details: { access_count: recentAccess.length, time_window: '5_minutes' }
      };
    }
    
    // Check for unusual IP address
    const userIPs = await this.getUserIPHistory(context.userId);
    const knownIPs = userIPs.slice(0, 5); // Last 5 IPs
    if (!knownIPs.includes(context.ipAddress)) {
      return {
        detected: true,
        type: 'UNUSUAL_IP_ADDRESS',
        details: { ip_address: context.ipAddress, known_ips: knownIPs }
      };
    }
    
    // Check for off-hours access
    const currentHour = new Date().getHours();
    if (currentHour < 6 || currentHour > 22) {
      return {
        detected: true,
        type: 'OFF_HOURS_ACCESS',
        details: { access_hour: currentHour }
      };
    }
    
    return { detected: false };
  }
  
  /**
   * Handle suspicious activity
   */
  private async handleSuspiciousActivity(
    context: PHIAccessContext,
    activity: { type: string; details: any }
  ): Promise<void> {
    // Log security incident
    await this.logSecurityIncident('SUSPICIOUS_ACTIVITY', {
      user_id: context.userId,
      tenant_id: context.tenantId,
      activity_type: activity.type,
      details: activity.details,
      ip_address: context.ipAddress,
      user_agent: context.userAgent
    });
    
    // Send alert to administrators
    await this.sendSecurityAlert(context, activity);
    
    // Consider additional actions based on activity type
    switch (activity.type) {
      case 'RAPID_ACCESS_PATTERN':
        // Could implement temporary access throttling
        break;
      case 'UNUSUAL_IP_ADDRESS':
        // Could require additional authentication
        break;
      case 'OFF_HOURS_ACCESS':
        // Could require manager approval
        break;
    }
  }
  
  // Helper methods
  
  private getClientIP(request: NextRequest): string {
    const forwarded = request.headers.get('x-forwarded-for');
    const real = request.headers.get('x-real-ip');
    
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    
    if (real) {
      return real;
    }
    
    return 'unknown';
  }
  
  private extractDataType(pathname: string): 'appointment' | 'medical_record' | 'prescription' | 'image' | 'document' {
    if (pathname.includes('/patients')) return 'medical_record';
    if (pathname.includes('/appointments')) return 'appointment';
    if (pathname.includes('/prescriptions')) return 'prescription';
    if (pathname.includes('/images')) return 'image';
    if (pathname.includes('/documents')) return 'document';
    return 'medical_record'; // Default
  }
  
  private mapMethodToAction(method: string): 'view' | 'create' | 'update' | 'delete' | 'print' | 'export' {
    switch (method.toUpperCase()) {
      case 'GET': return 'view';
      case 'POST': return 'create';
      case 'PUT': 
      case 'PATCH': return 'update';
      case 'DELETE': return 'delete';
      default: return 'view';
    }
  }
  
  private extractPatientId(request: NextRequest): string {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    
    // Look for patient ID in URL path or query params
    const patientIdFromPath = pathParts.find(part => part.match(/^[0-9a-f-]{36}$/));
    if (patientIdFromPath) return patientIdFromPath;
    
    const patientIdFromQuery = url.searchParams.get('patient_id');
    if (patientIdFromQuery) return patientIdFromQuery;
    
    return 'unknown';
  }
  
  private async getTodayAccessCount(userId: string, tenantId: string): Promise<number> {
    const { count } = await this.supabase
      .from('phi_access_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .gte('accessed_at', new Date().toDateString());
    
    return count || 0;
  }
  
  private async getRecentAccess(userId: string, timeWindowMs: number): Promise<any[]> {
    const { data } = await this.supabase
      .from('phi_access_logs')
      .select('accessed_at')
      .eq('user_id', userId)
      .gte('accessed_at', new Date(Date.now() - timeWindowMs).toISOString());
    
    return data || [];
  }
  
  private async getUserIPHistory(userId: string): Promise<string[]> {
    const { data } = await this.supabase
      .from('phi_access_logs')
      .select('ip_address')
      .eq('user_id', userId)
      .order('accessed_at', { ascending: false })
      .limit(10);
    
    return data ? [...new Set(data.map(record => record.ip_address))] : [];
  }
  
  private async logSecurityIncident(type: string, details: any): Promise<void> {
    try {
      await this.supabase
        .from('security_incidents')
        .insert({
          incident_type: type,
          severity: 'medium',
          description: `Automated detection: ${type}`,
          details: JSON.stringify(details),
          tenant_id: details.tenant_id || 'system'
        });
    } catch (error) {
      console.error('Error logging security incident:', error);
    }
  }
  
  private async sendSecurityAlert(context: PHIAccessContext, activity: any): Promise<void> {
    // Implementation for sending alerts to administrators
    console.log('Security Alert:', {
      user_id: context.userId,
      activity_type: activity.type,
      details: activity.details
    });
  }
}

// Export configured middleware instance
export const hipaaMiddleware = new HIPAAMiddleware({
  enabled: process.env.NODE_ENV === 'production',
  logAllAccess: true,
  requireJustification: false, // Can be enabled for high-security environments
  maxAccessAttempts: 100
});