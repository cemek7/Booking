import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { observability } from '../observability/observability';
import { EventBusService } from '../eventbus/eventBus';
import { webcrypto as crypto } from 'crypto';

// Import services
import { MFAService, MFAVerificationSchema } from './services/mfa-service';
import { SessionService, SessionCreateSchema } from './services/session-service';
import { APIKeyService, APIKeyCreateSchema } from './services/api-key-service';
import { SecurityService } from './services/security-service';

// Import canonical auth types
import type {
  AuthenticationEvent,
  UserSession,
  LoginData,
  ClientInfo,
  LoginResult,
} from '@/types/auth';

// Re-export schemas for backwards compatibility
export { MFAVerificationSchema, SessionCreateSchema, APIKeyCreateSchema };

interface SecurityMetrics {
  login_count: number;
  failed_login_count: number;
  unique_ips: number;
  unique_devices: number;
  mfa_verifications: number;
  password_changes: number;
  lockout_events: number;
  last_login?: Date;
  suspicious_activity_score: 'low' | 'medium' | 'high';
}

/**
 * Enhanced authentication service with enterprise-grade security features.
 * Provides MFA, session management, audit logging, and security monitoring.
 *
 * This class acts as a facade/orchestrator that composes specialized services:
 * - MFAService: Multi-factor authentication
 * - SessionService: Session management
 * - APIKeyService: API key operations
 * - SecurityService: Rate limiting, lockouts, security metrics
 */
export class EnhancedAuthService {
  private supabase: ReturnType<typeof getSupabaseRouteHandlerClient>;
  private eventBus: EventBusService;
  private isInitialized = false;

  // Composed services
  private mfaService: MFAService;
  private sessionService: SessionService;
  private apiKeyService: APIKeyService;
  private securityService: SecurityService;

  // Performance metrics
  private metrics = {
    authenticationsProcessed: 0,
    mfaVerifications: 0,
    sessionsCreated: 0,
    securityEvents: 0,
    lockoutsTriggered: 0,
  };

  constructor() {
    this.supabase = getSupabaseRouteHandlerClient();
    this.eventBus = new EventBusService();

    // Initialize composed services
    this.mfaService = new MFAService(this.supabase);
    this.sessionService = new SessionService(this.supabase);
    this.apiKeyService = new APIKeyService(this.supabase);
    this.securityService = new SecurityService(this.supabase);
  }

  /**
   * Set the Supabase client (useful for different contexts)
   */
  setSupabaseClient(supabaseClient: ReturnType<typeof getSupabaseRouteHandlerClient>) {
    this.supabase = supabaseClient;
    // Re-initialize services with new client
    this.mfaService = new MFAService(this.supabase);
    this.sessionService = new SessionService(this.supabase);
    this.apiKeyService = new APIKeyService(this.supabase);
    this.securityService = new SecurityService(this.supabase);
  }

  /**
   * Initialize the enhanced authentication service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.sessionService.startPeriodicCleanup();
    this.isInitialized = true;
    console.log('EnhancedAuthService initialized successfully');
  }

  /**
   * Main login flow
   */
  async login(loginData: LoginData, clientInfo: ClientInfo): Promise<LoginResult> {
    const { email, password, mfa_code, remember_me, device_fingerprint } = loginData;

    // 1. Rate limiting check
    const rateLimitResult = await this.securityService.checkRateLimit(
      clientInfo.ip_address || 'unknown',
      'login'
    );
    if (!rateLimitResult.allowed) {
      return {
        success: false,
        error: 'Too many login attempts. Please try again later.',
        error_details: { reset_time: rateLimitResult.resetTime },
        status: 429,
      };
    }

    // 2. Get user by email
    const { data: user, error: userError } = await this.supabase.auth.admin.getUserByEmail(email);

    if (userError || !user) {
      await this.logAuthEvent({
        user_id: 'unknown',
        event_type: 'login_failed',
        success: false,
        failure_reason: 'user_not_found',
        ip_address: clientInfo.ip_address,
        user_agent: clientInfo.user_agent,
      });
      return { success: false, error: 'Invalid credentials', status: 401 };
    }

    // 3. Check account lockout
    const lockoutStatus = await this.securityService.checkAccountLockout(user.user.id);
    if (lockoutStatus.isLocked) {
      return {
        success: false,
        error: 'Account is locked',
        error_details: {
          reason: lockoutStatus.lockoutReason,
          unlock_at: lockoutStatus.unlockAt,
        },
        status: 423,
      };
    }

    // 4. Authenticate with Supabase
    const { data: authData, error: authError } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.user) {
      await this.logAuthEvent({
        user_id: user.user.id,
        event_type: 'login_failed',
        success: false,
        failure_reason: 'invalid_credentials',
        ip_address: clientInfo.ip_address,
        user_agent: clientInfo.user_agent,
      });
      return { success: false, error: 'Invalid credentials', status: 401 };
    }

    // 5. Check MFA requirements
    const { data: mfaConfig } = await this.supabase
      .from('multi_factor_auth')
      .select('id, method')
      .eq('user_id', authData.user.id)
      .eq('is_enabled', true);

    const hasMFA = mfaConfig && mfaConfig.length > 0;
    let mfaVerified = false;

    if (hasMFA) {
      if (!mfa_code) {
        return {
          success: true,
          mfa_required: true,
          mfa_verified: false,
          user: { id: authData.user.id, email: authData.user.email },
          status: 200,
        };
      }

      const mfaResult = await this.verifyMFA({
        user_id: authData.user.id,
        method: mfaConfig[0].method,
        code: mfa_code,
      });

      mfaVerified = mfaResult.verified;

      if (!mfaVerified) {
        return {
          success: false,
          error: 'Invalid MFA code',
          error_details: { remaining_attempts: mfaResult.remainingAttempts },
          status: 401,
        };
      }
    }

    // 6. Create session
    const sessionDuration = remember_me ? 30 * 24 * 60 : 8 * 60;
    const session = await this.createSession({
      user_id: authData.user.id,
      ip_address: clientInfo.ip_address,
      user_agent: clientInfo.user_agent,
      device_fingerprint: device_fingerprint,
      expires_in_minutes: sessionDuration,
    });

    // 7. Log successful login
    await this.logAuthEvent({
      user_id: authData.user.id,
      event_type: 'login',
      success: true,
      ip_address: clientInfo.ip_address,
      user_agent: clientInfo.user_agent,
      session_id: session.id,
      metadata: {
        mfa_verified: mfaVerified,
        remember_me,
        session_duration_minutes: sessionDuration,
      },
    });

    return {
      success: true,
      user: {
        id: authData.user.id,
        email: authData.user.email,
        tenant_id: session.tenant_id,
      },
      session: session,
      mfa_required: hasMFA,
      mfa_verified: mfaVerified,
      status: 200,
    };
  }

  /**
   * Log authentication event
   */
  async logAuthEvent(event: AuthenticationEvent): Promise<string> {
    const traceContext = observability.startTrace('auth.log_event');

    try {
      observability.setTraceTag(traceContext, 'event_type', event.event_type);
      observability.setTraceTag(traceContext, 'user_id', event.user_id);

      const { data, error } = await this.supabase.rpc('log_authentication_event', {
        p_user_id: event.user_id,
        p_event_type: event.event_type,
        p_ip_address: event.ip_address,
        p_user_agent: event.user_agent,
        p_success: event.success,
        p_failure_reason: event.failure_reason,
        p_metadata: event.metadata || {},
      });

      if (error) throw error;

      // Publish event for external systems
      await this.publishAuthEvent({
        eventType: 'auth.event_logged',
        payload: {
          log_id: data,
          user_id: event.user_id,
          event_type: event.event_type,
          success: event.success,
        },
      });

      this.metrics.authenticationsProcessed++;
      if (!event.success) {
        this.metrics.securityEvents++;
      }

      observability.recordBusinessMetric('auth_event_logged_total', 1, {
        event_type: event.event_type,
        success: event.success ? 'true' : 'false',
      });

      observability.finishTrace(traceContext, 'success');
      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to log auth event', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  // ===============================
  // MFA OPERATIONS (delegated to MFAService)
  // ===============================

  async setupTOTP(userId: string) {
    return this.mfaService.setupTOTP(userId);
  }

  async verifyMFA(data: { user_id: string; method: 'totp' | 'sms' | 'email' | 'backup_codes'; code: string; session_id?: string }) {
    this.metrics.mfaVerifications++;
    return this.mfaService.verifyMFA(data, this.logAuthEvent.bind(this));
  }

  async getMfaStatus(userId: string) {
    return this.mfaService.getMfaStatus(userId);
  }

  async markSessionAsMfaVerified(sessionId: string) {
    return this.mfaService.markSessionAsMfaVerified(sessionId);
  }

  // ===============================
  // SESSION OPERATIONS (delegated to SessionService)
  // ===============================

  async createSession(data: { user_id: string; ip_address?: string; user_agent?: string; device_fingerprint?: string; expires_in_minutes?: number }): Promise<UserSession> {
    this.metrics.sessionsCreated++;
    return this.sessionService.createSession(data);
  }

  async getSession(sessionToken: string) {
    return this.sessionService.getSession(sessionToken);
  }

  async getActiveSessions(userId: string) {
    return this.sessionService.getActiveSessions(userId);
  }

  async terminateSession(sessionId: string, reason: string) {
    return this.sessionService.terminateSession(sessionId, reason);
  }

  async terminateAllUserSessions(userId: string, reason: string) {
    return this.sessionService.terminateAllUserSessions(userId, reason);
  }

  async cleanupExpiredSessions() {
    return this.sessionService.cleanupExpiredSessions();
  }

  // ===============================
  // API KEY OPERATIONS (delegated to APIKeyService)
  // ===============================

  async createAPIKey(data: { user_id: string; tenant_id: string; name: string; description?: string; scopes?: string[]; rate_limit_per_hour?: number; expires_in_days?: number }) {
    return this.apiKeyService.createAPIKey(data);
  }

  async validateAPIKey(apiKey: string) {
    return this.apiKeyService.validateAPIKey(apiKey);
  }

  async revokeAPIKey(keyId: string, userId: string) {
    return this.apiKeyService.revokeAPIKey(keyId, userId);
  }

  async getAPIKey(keyId: string, userId: string) {
    return this.apiKeyService.getAPIKey(keyId, userId);
  }

  async getUserAPIKeys(userId: string) {
    return this.apiKeyService.getUserAPIKeys(userId);
  }

  // ===============================
  // SECURITY OPERATIONS (delegated to SecurityService)
  // ===============================

  async checkRateLimit(identifier: string, action: string) {
    return this.securityService.checkRateLimit(identifier, action);
  }

  async checkAccountLockout(userId: string) {
    return this.securityService.checkAccountLockout(userId);
  }

  async lockUserAccount(userId: string, reason: string, durationMinutes?: number, lockedBy?: string) {
    this.metrics.lockoutsTriggered++;
    const result = await this.securityService.lockUserAccount(userId, reason, durationMinutes, lockedBy);
    // Terminate all sessions when account is locked
    await this.terminateAllUserSessions(userId, 'account_locked');
    return result;
  }

  async getUserSecurityMetrics(userId: string, daysBack?: number): Promise<SecurityMetrics> {
    return this.securityService.getUserSecurityMetrics(userId, daysBack);
  }

  async getRecentAuthLogs(userId: string, limit?: number) {
    return this.securityService.getRecentAuthLogs(userId, limit);
  }

  // ===============================
  // PRIVATE HELPERS
  // ===============================

  private async publishAuthEvent(event: { eventType: string; payload: Record<string, unknown>; metadata?: Record<string, unknown> }) {
    if (!this.eventBus?.publish) {
      console.warn('Event bus is not configured or does not have a publish method.');
      return;
    }

    try {
      const fullEvent = {
        id: crypto.randomUUID(),
        aggregateId: (event.payload.user_id as string) || 'system',
        aggregateType: 'user',
        eventType: event.eventType,
        eventVersion: 1,
        payload: event.payload,
        metadata: event.metadata || {},
        timestamp: new Date().toISOString(),
      };
      await this.eventBus.publish(fullEvent);
    } catch (error) {
      console.error('Failed to publish auth event:', error);
    }
  }
}

// Export singleton instance
export const enhancedAuth = new EnhancedAuthService();
