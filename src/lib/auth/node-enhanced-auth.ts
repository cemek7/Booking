import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { observability } from '../observability/observability';
import { EventBusService } from '../eventbus/eventBus';
import { webcrypto as crypto } from 'crypto';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';

// PHASE 2B: Import canonical auth types from consolidated location
import type {
  AuthenticationEvent,
  UserSession,
  LoginData,
  ClientInfo,
  LoginResult
} from '@/types/auth';

// Types and validation schemas
const MFASetupSchema = z.object({
  user_id: z.string().uuid(),
  method: z.enum(['totp', 'sms', 'email']),
  phone_number: z.string().optional(),
  email: z.string().email().optional()
});

const MFAVerificationSchema = z.object({
  user_id: z.string().uuid(),
  method: z.enum(['totp', 'sms', 'email', 'backup_codes']),
  code: z.string(),
  session_id: z.string().optional()
});

const SessionCreateSchema = z.object({
  user_id: z.string().uuid(),
  ip_address: z.string().optional(),
  user_agent: z.string().optional(),
  device_fingerprint: z.string().optional(),
  expires_in_minutes: z.number().default(480) // 8 hours default
});

const SecuritySettingsSchema = z.object({
  user_id: z.string().uuid(),
  mfa_required: z.boolean().optional(),
  session_timeout_minutes: z.number().min(5).max(43200).optional(), // 5 minutes to 30 days
  max_concurrent_sessions: z.number().min(1).max(10).optional(),
  password_expiry_days: z.number().min(30).max(365).optional(),
  allowed_ip_ranges: z.array(z.string()).optional(),
  security_questions: z.array(z.object({
    question: z.string(),
    answer_hash: z.string()
  })).optional()
});

const APIKeyCreateSchema = z.object({
  user_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  scopes: z.array(z.string()).default([]),
  rate_limit_per_hour: z.number().min(1).max(10000).default(1000),
  expires_in_days: z.number().min(1).max(365).optional()
});



/**
 * Enhanced authentication service with enterprise-grade security features
 * Provides MFA, session management, audit logging, and security monitoring
 */
export class EnhancedAuthService {
  private supabase: any;
  private eventBus: EventBusService;
  private isInitialized = false;

  // Configuration
  private config = {
    totp: {
      service_name: process.env.TOTP_SERVICE_NAME || 'BookingSystem',
      window: 2, // Allow 2 time windows before/after
      step: 30 // 30 second time step
    },
    session: {
      default_timeout_minutes: 480, // 8 hours
      max_concurrent_sessions: 5,
      cleanup_interval_hours: 1
    },
    security: {
      max_failed_attempts: 5,
      lockout_duration_minutes: 15,
      password_min_length: 12,
      password_history_count: 5
    },
    api_keys: {
      key_length: 32,
      default_rate_limit: 1000
    }
  };

  // Performance metrics
  private metrics = {
    authenticationsProcessed: 0,
    mfaVerifications: 0,
    sessionsCreated: 0,
    securityEvents: 0,
    lockoutsTriggered: 0
  };

  constructor() {
    this.supabase = getSupabaseRouteHandlerClient();
    this.eventBus = new EventBusService();
  }

  /**
   * Manually set the Supabase client. Useful for using specific clients (e.g., admin) in different contexts.
   * @param supabaseClient The Supabase client instance.
   */
  setSupabaseClient(supabaseClient: any) {
    this.supabase = supabaseClient;
  }

  /**
   * Initialize the enhanced authentication service
   */
  async initialize(): Promise<void> {
    try {
      if (this.isInitialized) return;

      // Start periodic cleanup
      this.startPeriodicCleanup();

      this.isInitialized = true;
      console.log('EnhancedAuthService initialized successfully');
    } catch (error) {
      console.error('Failed to initialize EnhancedAuthService:', error);
      throw error;
    }
  }

  async login(loginData: LoginData, clientInfo: ClientInfo): Promise<LoginResult> {
    const { email, password, mfa_code, remember_me, device_fingerprint } = loginData;

    // 1. Rate limiting check
    const rateLimitResult = await this.checkRateLimit(clientInfo.ip_address || 'unknown', 'login');
    if (!rateLimitResult.allowed) {
      return {
        success: false,
        error: 'Too many login attempts. Please try again later.',
        error_details: { reset_time: rateLimitResult.resetTime },
        status: 429
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
        user_agent: clientInfo.user_agent
      });
      return { success: false, error: 'Invalid credentials', status: 401 };
    }

    // 3. Check account lockout
    const lockoutStatus = await this.checkAccountLockout(user.user.id);
    if (lockoutStatus.isLocked) {
      return {
        success: false,
        error: 'Account is locked',
        error_details: {
          reason: lockoutStatus.lockoutReason,
          unlock_at: lockoutStatus.unlockAt
        },
        status: 423
      };
    }

    // 4. Authenticate with Supabase (verifies password)
    const { data: authData, error: authError } = await this.supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError || !authData.user) {
      await this.logAuthEvent({
        user_id: user.user.id,
        event_type: 'login_failed',
        success: false,
        failure_reason: 'invalid_credentials',
        ip_address: clientInfo.ip_address,
        user_agent: clientInfo.user_agent
      });
      return { success: false, error: 'Invalid credentials', status: 401 };
    }

    // 5. Check if MFA is required and verify if code is provided
    const { data: mfaConfig } = await this.supabase
      .from('multi_factor_auth')
      .select('id, method')
      .eq('user_id', authData.user.id)
      .eq('is_enabled', true);

    const hasMFA = mfaConfig && mfaConfig.length > 0;
    let mfaVerified = false;

    if (hasMFA) {
      if (!mfa_code) {
        // MFA is required but no code was provided.
        // We don't create a session. The UI should prompt for the MFA code.
        return {
          success: true, // Login was successful, but MFA is the next step
          mfa_required: true,
          mfa_verified: false,
          user: { id: authData.user.id, email: authData.user.email },
          status: 200 // Or a specific status indicating MFA is needed
        };
      }

      // Verify MFA code
      const mfaResult = await this.verifyMFA({
        user_id: authData.user.id,
        method: mfaConfig[0].method, // Use the user's configured method
        code: mfa_code
      });

      mfaVerified = mfaResult.verified;

      if (!mfaVerified) {
        return {
          success: false,
          error: 'Invalid MFA code',
          error_details: { remaining_attempts: mfaResult.remainingAttempts },
          status: 401
        };
      }
    }

    // 6. Create enhanced session
    const sessionDuration = remember_me ? 30 * 24 * 60 : 8 * 60; // 30 days or 8 hours
    const session = await this.createSession({
      user_id: authData.user.id,
      ip_address: clientInfo.ip_address,
      user_agent: clientInfo.user_agent,
      device_fingerprint: device_fingerprint,
      expires_in_minutes: sessionDuration
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
        mfa_verified,
        remember_me,
        session_duration_minutes: sessionDuration
      }
    });

    return {
      success: true,
      user: {
        id: authData.user.id,
        email: authData.user.email,
        tenant_id: session.tenant_id
      },
      session: session,
      mfa_required: hasMFA,
      mfa_verified: mfaVerified,
      status: 200
    };
  }

  /**
   * Publish an authentication event to the event bus.
   */
  private async publishAuthEvent(event: Omit<Event, 'id' | 'timestamp' | 'eventVersion' | 'aggregateId' | 'aggregateType' | 'payload'> & { payload: any }) {
    if (!(this.eventBus && typeof this.eventBus.publish === 'function')) {
      console.warn('Event bus is not configured or does not have a publish method.');
      return;
    }
    
    try {
      const fullEvent: Event = {
        id: crypto.randomUUID(),
        aggregateId: event.payload.user_id || 'system',
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
      // Decide if we should throw or just log. For now, just log.
    }
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
        p_metadata: event.metadata || {}
      });

      if (error) throw error;

      // Publish event for external systems
      await this.publishAuthEvent({
        eventType: 'auth.event_logged',
        payload: {
          log_id: data,
          user_id: event.user_id,
          event_type: event.event_type,
          success: event.success
        }
      });

      this.metrics.authenticationsProcessed++;
      if (!event.success) {
        this.metrics.securityEvents++;
      }

      observability.recordBusinessMetric('auth_event_logged_total', 1, {
        event_type: event.event_type,
        success: event.success ? 'true' : 'false'
      });

      observability.finishTrace(traceContext, 'success');
      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to log auth event', {
        error_message: errorMessage
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Check rate limit for a given action and identifier
   */
  async checkRateLimit(identifier: string, action: string): Promise<{ allowed: boolean; resetTime?: Date }> {
    const traceContext = observability.startTrace('auth.check_rate_limit');
    try {
      observability.setTraceTag(traceContext, 'identifier', identifier);
      observability.setTraceTag(traceContext, 'action', action);

      const { data, error } = await this.supabase.rpc('check_rate_limit', {
        p_identifier: identifier,
        p_action: action,
      });

      if (error) throw error;

      const result = data[0] || { allowed: true };
      
      observability.finishTrace(traceContext, 'success');
      
      return {
        allowed: result.allowed,
        resetTime: result.reset_time ? new Date(result.reset_time) : undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to check rate limit', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      // Fail open: if rate limiting check fails, allow the action
      return { allowed: true };
    }
  }

  /**
   * Check account lockout status
   */
  async checkAccountLockout(userId: string): Promise<{
    isLocked: boolean;
    lockoutReason?: string;
    lockedAt?: Date;
    unlockAt?: Date;
    attemptsRemaining?: number;
  }> {
    const traceContext = observability.startTrace('auth.check_lockout');
    
    try {
      observability.setTraceTag(traceContext, 'user_id', userId);

      const { data, error } = await this.supabase.rpc('check_account_lockout', {
        p_user_id: userId
      });

      if (error) throw error;

      const result = data[0] || {
        is_locked: false,
        lockout_reason: null,
        locked_at: null,
        unlock_at: null,
        attempts_remaining: 5
      };

      observability.finishTrace(traceContext, 'success');

      return {
        isLocked: result.is_locked,
        lockoutReason: result.lockout_reason,
        lockedAt: result.locked_at ? new Date(result.locked_at) : undefined,
        unlockAt: result.unlock_at ? new Date(result.unlock_at) : undefined,
        attemptsRemaining: result.attempts_remaining
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to check account lockout', {
        error_message: errorMessage
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Lock user account
   */
  async lockUserAccount(
    userId: string,
    reason: string,
    durationMinutes: number = 15,
    lockedBy?: string
  ): Promise<string> {
    const traceContext = observability.startTrace('auth.lock_account');
    
    try {
      observability.setTraceTag(traceContext, 'user_id', userId);
      observability.setTraceTag(traceContext, 'reason', reason);

      const { data, error } = await this.supabase.rpc('lock_user_account', {
        p_user_id: userId,
        p_reason: reason,
        p_duration_minutes: durationMinutes,
        p_locked_by: lockedBy
      });

      if (error) throw error;

      // Terminate all active sessions for the locked user
      await this.terminateAllUserSessions(userId, 'account_locked');

      // Publish lockout event
      await this.publishAuthEvent({
        eventType: 'auth.account_locked',
        payload: {
          user_id: userId,
          reason,
          duration_minutes: durationMinutes,
          locked_by: lockedBy,
          lockout_id: data
        }
      });

      this.metrics.lockoutsTriggered++;

      observability.recordBusinessMetric('auth_account_locked_total', 1, {
        reason
      });

      observability.finishTrace(traceContext, 'success');
      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to lock account', {
        error_message: errorMessage
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Set up TOTP MFA for user
   */
  async setupTOTP(userId: string): Promise<{
    secret: string;
    qrCodeUrl: string;
    backupCodes: string[];
  }> {
    const traceContext = observability.startTrace('auth.setup_totp');
    
    try {
      observability.setTraceTag(traceContext, 'user_id', userId);

      // Generate TOTP secret
      const secret = authenticator.generateSecret();
      
      // Get user info for QR code
      const { data: user } = await this.supabase.auth.admin.getUserById(userId);
      if (!user) throw new Error('User not found');

      // Generate QR code URL
      const otpauthUrl = authenticator.keyuri(
        user.user.email!,
        this.config.totp.service_name,
        secret
      );

      // Generate QR code data URL
      const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

      // Generate backup codes
      const backupCodes = this.generateBackupCodes();

      // Encrypt and store MFA configuration
      const encryptedSecret = this.encrypt(secret);
      const encryptedBackupCodes = this.encrypt(JSON.stringify(backupCodes));

      const { error } = await this.supabase
        .from('multi_factor_auth')
        .insert({
          user_id: userId,
          method: 'totp',
          is_primary: true,
          is_enabled: false, // Will be enabled after verification
          secret_encrypted: encryptedSecret,
          backup_codes_encrypted: encryptedBackupCodes
        });

      if (error) throw error;

      observability.recordBusinessMetric('auth_mfa_setup_total', 1, {
        method: 'totp'
      });

      observability.finishTrace(traceContext, 'success');

      return {
        secret,
        qrCodeUrl,
        backupCodes
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to setup TOTP', {
        error_message: errorMessage
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Verify MFA code
   */
  async verifyMFA(data: z.infer<typeof MFAVerificationSchema>): Promise<{
    verified: boolean;
    remainingAttempts?: number;
    isBackupCode?: boolean;
  }> {
    const traceContext = observability.startTrace('auth.verify_mfa');
    
    try {
      const validatedData = MFAVerificationSchema.parse(data);
      observability.setTraceTag(traceContext, 'user_id', validatedData.user_id);
      observability.setTraceTag(traceContext, 'method', validatedData.method);

      // Get MFA configuration
      const { data: mfaConfig, error } = await this.supabase
        .from('multi_factor_auth')
        .select('*')
        .eq('user_id', validatedData.user_id)
        .eq('method', validatedData.method)
        .eq('is_enabled', true)
        .single();

      if (error || !mfaConfig) {
        throw new Error('MFA not configured for this method');
      }

      // Check if blocked due to too many failures
      if (mfaConfig.blocked_until && new Date(mfaConfig.blocked_until) > new Date()) {
        throw new Error('MFA temporarily blocked due to too many failures');
      }

      let verified = false;
      let isBackupCode = false;

      // Verify based on method
      switch (validatedData.method) {
        case 'totp':
          verified = await this.verifyTOTPCode(mfaConfig, validatedData.code);
          break;
        case 'backup_codes':
          const result = await this.verifyBackupCode(mfaConfig, validatedData.code);
          verified = result.verified;
          isBackupCode = true;
          break;
        default:
          throw new Error(`MFA method ${validatedData.method} not supported`);
      }

      // Log verification attempt
      await this.supabase
        .from('mfa_verification_attempts')
        .insert({
          user_id: validatedData.user_id,
          mfa_id: mfaConfig.id,
          method: validatedData.method,
          code_provided: validatedData.code.substring(0, 4) + '***', // Partial code for audit
          success: verified,
          failure_reason: verified ? null : 'Invalid code'
        });

      if (verified) {
        // Update MFA record
        await this.supabase
          .from('multi_factor_auth')
          .update({
            last_used_at: new Date().toISOString(),
            failure_count: 0,
            blocked_until: null
          })
          .eq('id', mfaConfig.id);

        // Enable MFA if this is first successful verification
        if (!mfaConfig.verified_at) {
          await this.supabase
            .from('multi_factor_auth')
            .update({
              verified_at: new Date().toISOString(),
              is_enabled: true
            })
            .eq('id', mfaConfig.id);
        }

        // Log successful verification
        await this.logAuthEvent({
          user_id: validatedData.user_id,
          event_type: 'mfa_verify',
          success: true,
          session_id: validatedData.session_id,
          metadata: {
            method: validatedData.method,
            is_backup_code: isBackupCode
          }
        });

        this.metrics.mfaVerifications++;
      } else {
        // Increment failure count
        const newFailureCount = mfaConfig.failure_count + 1;
        const updates: any = { failure_count: newFailureCount };

        // Block if too many failures
        if (newFailureCount >= 5) {
          updates.blocked_until = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
        }

        await this.supabase
          .from('multi_factor_auth')
          .update(updates)
          .eq('id', mfaConfig.id);

        // Log failed verification
        await this.logAuthEvent({
          user_id: validatedData.user_id,
          event_type: 'mfa_failed',
          success: false,
          failure_reason: 'invalid_code',
          session_id: validatedData.session_id,
          metadata: {
            method: validatedData.method,
            remaining_attempts: 5 - newFailureCount
          }
        });
      }

      observability.finishTrace(traceContext, 'success');

      return {
        verified,
        remainingAttempts: 5 - (verified ? 0 : newFailureCount),
        isBackupCode
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to verify MFA', {
        error_message: errorMessage
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Create enhanced session
   */
  async createSession(data: z.infer<typeof SessionCreateSchema>): Promise<UserSession> {
    const traceContext = observability.startTrace('auth.create_session');
    
    try {
      const validatedData = SessionCreateSchema.parse(data);
      observability.setTraceTag(traceContext, 'user_id', validatedData.user_id);

      // Generate secure session token
      const sessionToken = this.generateSecureToken();
      const expiresAt = new Date(Date.now() + validatedData.expires_in_minutes * 60 * 1000);

      // Get user's tenant ID
      const { data: userTenant } = await this.supabase
        .from('tenant_users')
        .select('tenant_id')
        .eq('user_id', validatedData.user_id)
        .single();

      // Create session record
      const { data: session, error } = await this.supabase
        .from('user_sessions')
        .insert({
          session_token: sessionToken,
          user_id: validatedData.user_id,
          tenant_id: userTenant?.tenant_id,
          ip_address: validatedData.ip_address,
          user_agent: validatedData.user_agent,
          device_fingerprint: validatedData.device_fingerprint,
          expires_at: expiresAt.toISOString(),
          is_active: true
        })
        .select()
        .single();

      if (error) throw error;

      this.metrics.sessionsCreated++;

      observability.recordBusinessMetric('auth_session_created_total', 1);

      observability.finishTrace(traceContext, 'success');

      return {
        id: session.id,
        session_token: session.session_token,
        user_id: session.user_id,
        tenant_id: session.tenant_id,
        ip_address: session.ip_address,
        user_agent: session.user_agent,
        device_fingerprint: session.device_fingerprint,
        is_active: session.is_active,
        last_activity: new Date(session.last_activity),
        expires_at: new Date(session.expires_at),
        metadata: session.metadata
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to create session', {
        error_message: errorMessage
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Get user security metrics
   */
  async getUserSecurityMetrics(userId: string, daysBack: number = 30): Promise<SecurityMetrics> {
    const traceContext = observability.startTrace('auth.get_security_metrics');
    
    try {
      observability.setTraceTag(traceContext, 'user_id', userId);

      const { data, error } = await this.supabase.rpc('get_user_security_metrics', {
        p_user_id: userId,
        p_days_back: daysBack
      });

      if (error) throw error;

      observability.finishTrace(traceContext, 'success');

      return {
        login_count: data.login_count || 0,
        failed_login_count: data.failed_login_count || 0,
        unique_ips: data.unique_ips || 0,
        unique_devices: data.unique_devices || 0,
        mfa_verifications: data.mfa_verifications || 0,
        password_changes: data.password_changes || 0,
        lockout_events: data.lockout_events || 0,
        last_login: data.last_login ? new Date(data.last_login) : undefined,
        suspicious_activity_score: data.suspicious_activity_score || 'low'
      };
    } catch (error) {
      observability.addTraceLog(traceContext, 'error', 'Failed to get security metrics', {
        error_message: error.message
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Create API key
   */
  async createAPIKey(data: z.infer<typeof APIKeyCreateSchema>): Promise<{
    keyId: string;
    apiKey: string;
    hashedKey: string;
  }> {
    const traceContext = observability.startTrace('auth.create_api_key');
    
    try {
      const validatedData = APIKeyCreateSchema.parse(data);
      observability.setTraceTag(traceContext, 'user_id', validatedData.user_id);

      // Generate API key
      const keyId = this.generateKeyId();
      const apiKey = this.generateAPIKey();
      const hashedKey = await bcrypt.hash(apiKey, 12);

      const expiresAt = validatedData.expires_in_days 
        ? new Date(Date.now() + validatedData.expires_in_days * 24 * 60 * 60 * 1000)
        : null;

      // Create API key record
      const { data: keyRecord, error } = await this.supabase
        .from('api_keys')
        .insert({
          key_id: keyId,
          key_hash: hashedKey,
          user_id: validatedData.user_id,
          tenant_id: validatedData.tenant_id,
          name: validatedData.name,
          description: validatedData.description,
          scopes: validatedData.scopes,
          rate_limit_per_hour: validatedData.rate_limit_per_hour,
          expires_at: expiresAt?.toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      observability.recordBusinessMetric('auth_api_key_created_total', 1);

      observability.finishTrace(traceContext, 'success');

      return {
        keyId,
        apiKey: `${keyId}.${apiKey}`, // Format: keyId.secret
        hashedKey
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to create API key', {
        error_message: errorMessage
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Get a user's active sessions.
   */
  async getActiveSessions(userId: string): Promise<any[]> {
    const traceContext = observability.startTrace('auth.get_active_sessions');
    try {
      observability.setTraceTag(traceContext, 'user_id', userId);

      const { data, error } = await this.supabase
        .from('user_sessions')
        .select('id, ip_address, user_agent, created_at, last_activity')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('last_activity', { ascending: false });

      if (error) throw error;

      observability.finishTrace(traceContext, 'success');
      return data || [];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to get active sessions', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Get recent authentication logs for a user.
   */
  async getRecentAuthLogs(userId: string, limit = 10): Promise<any[]> {
    const traceContext = observability.startTrace('auth.get_recent_logs');
    try {
      observability.setTraceTag(traceContext, 'user_id', userId);

      const { data, error } = await this.supabase
        .from('user_authentication_logs')
        .select('event_type, ip_address, success, created_at, failure_reason')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      observability.finishTrace(traceContext, 'success');
      return data || [];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to get recent auth logs', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Get security metrics for a user
   */
  async getUserSecurityMetrics(userId: string): Promise<SecurityMetrics> {
    const traceContext = observability.startTrace('auth.get_security_metrics');
    
    try {
      observability.setTraceTag(traceContext, 'user_id', userId);

      const { data, error } = await this.supabase.rpc('get_user_security_metrics', {
        p_user_id: userId
      });

      if (error) throw error;

      observability.finishTrace(traceContext, 'success');

      return {
        login_count: data.login_count || 0,
        failed_login_count: data.failed_login_count || 0,
        unique_ips: data.unique_ips || 0,
        unique_devices: data.unique_devices || 0,
        mfa_verifications: data.mfa_verifications || 0,
        password_changes: data.password_changes || 0,
        lockout_events: data.lockout_events || 0,
        last_login: data.last_login ? new Date(data.last_login) : undefined,
        suspicious_activity_score: data.suspicious_activity_score || 'low'
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to get security metrics', {
        error_message: errorMessage
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Revoke API key
   */
  async revokeAPIKey(keyId: string, userId: string): Promise<{ success: boolean }> {
    const traceContext = observability.startTrace('auth.revoke_api_key');
    
    try {
      observability.setTraceTag(traceContext, 'key_id', keyId);
      observability.setTraceTag(traceContext, 'user_id', userId);

      const { data, error } = await this.supabase
        .from('api_keys')
        .delete()
        .eq('key_id', keyId)
        .eq('user_id', userId)
        .select();

      if (error) throw error;

      observability.recordBusinessMetric('auth_api_key_revoked_total', 1);

      observability.finishTrace(traceContext, 'success');

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to revoke API key', {
        error_message: errorMessage
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Get API key details
   */
  async getAPIKey(keyId: string, userId: string): Promise<any> {
    const traceContext = observability.startTrace('auth.get_api_key');
    
    try {
      observability.setTraceTag(traceContext, 'key_id', keyId);
      observability.setTraceTag(traceContext, 'user_id', userId);

      const { data, error } = await this.supabase
        .from('api_keys')
        .select('*')
        .eq('key_id', keyId)
        .eq('user_id', userId)
        .single();

      if (error) throw error;

      observability.finishTrace(traceContext, 'success');

      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to get API key', {
        error_message: errorMessage
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Get all API keys for a user
   */
  async getUserAPIKeys(userId: string): Promise<any[]> {
    const traceContext = observability.startTrace('auth.get_user_api_keys');
    
    try {
      observability.setTraceTag(traceContext, 'user_id', userId);

      const { data, error } = await this.supabase
        .from('api_keys')
        .select('*')
        .eq('user_id', userId);

      if (error) throw error;

      observability.finishTrace(traceContext, 'success');

      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to get user API keys', {
        error_message: errorMessage
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Validate API key
   */
  async validateAPIKey(apiKey: string): Promise<{ valid: boolean; key_details?: any }> {
    const traceContext = observability.startTrace('auth.validate_api_key');
    
    try {
      const [keyId, secret] = apiKey.split('.');
      if (!keyId || !secret) {
        return { valid: false };
      }

      observability.setTraceTag(traceContext, 'key_id', keyId);

      // Get key details
      const { data, error } = await this.supabase
        .from('api_keys')
        .select('*')
        .eq('key_id', keyId)
        .single();

      if (error || !data) {
        return { valid: false };
      }

      // Validate hash
      const isValid = await bcrypt.compare(secret, data.key_hash);
      
      observability.finishTrace(traceContext, 'success');

      return { valid: isValid, key_details: data };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to validate API key', {
        error_message: errorMessage
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  // ===============================
  // SESSION MANAGEMENT
  /**
   * Cleanup expired sessions
   */
  async cleanupExpiredSessions(): Promise<void> {
    const traceContext = observability.startTrace('auth.cleanup_expired_sessions');
    
    try {
      const { data, error } = await this.supabase.rpc('cleanup_expired_sessions');

      if (error) throw error;

      observability.recordBusinessMetric('auth_sessions_cleaned_up_total', data.length, {
        reason: 'expired'
      });

      observability.finishTrace(traceContext, 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to cleanup expired sessions', {
        error_message: errorMessage
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Get session details from a session token
   */
  async getSession(sessionToken: string): Promise<UserSession | null> {
    const traceContext = observability.startTrace('auth.get_session');
    try {
      observability.setTraceTag(traceContext, 'session_id', sessionToken);

      const { data, error } = await this.supabase
        .from('user_sessions')
        .select('*')
        .eq('session_token', sessionToken)
        .single();

      if (error) throw error;

      observability.finishTrace(traceContext, 'success');

      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to get session', {
        error_message: errorMessage
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Terminate a specific user session
   */
  async terminateSession(sessionId: string, reason: string): Promise<{ success: boolean }> {
    const traceContext = observability.startTrace('auth.terminate_session');
    try {
      observability.setTraceTag(traceContext, 'session_id', sessionId);

      const { data, error } = await this.supabase
        .from('user_sessions')
        .update({
          is_active: false,
          force_logout: true,
          logout_reason: reason
        })
        .eq('id', sessionId)
        .eq('is_active', true)
        .select();

      if (error) throw error;

      observability.recordBusinessMetric('auth_session_terminated_total', 1, {
        reason
      });

      observability.finishTrace(traceContext, 'success');
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to terminate session', {
        error_message: errorMessage
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Terminate all active sessions for a user
   */
  async terminateAllUserSessions(
    userId: string,
    reason: string
  ): Promise<{ success: boolean; terminated_sessions: number }> {
    const traceContext = observability.startTrace('auth.terminate_all_sessions');
    try {
      observability.setTraceTag(traceContext, 'user_id', userId);

      const { data, error } = await this.supabase
        .from('user_sessions')
        .update({
          is_active: false,
          force_logout: true,
          logout_reason: reason
        })
        .eq('user_id', userId)
        .eq('is_active', true)
        .select();

      if (error) throw error;

      observability.recordBusinessMetric('auth_all_sessions_terminated_total', 1, {
        reason
      });

      observability.finishTrace(traceContext, 'success');
      return { success: true, terminated_sessions: data.length };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to terminate all user sessions', {
        error_message: errorMessage
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Marks a session as having been verified with MFA.
   */
  async markSessionAsMfaVerified(sessionId: string): Promise<{ success: boolean }> {
    const traceContext = observability.startTrace('auth.mark_session_mfa');
    try {
      observability.setTraceTag(traceContext, 'session_id', sessionId);

      const { data: session } = await this.supabase
        .from('user_sessions')
        .select('metadata')
        .eq('id', sessionId)
        .single();

      if (!session) {
        throw new Error('Session not found');
      }

      const { error } = await this.supabase
        .from('user_sessions')
        .update({
          metadata: {
            ...session.metadata,
            mfa_verified: true,
            mfa_verified_at: new Date().toISOString(),
          },
        })
        .eq('id', sessionId);

      if (error) throw error;

      observability.finishTrace(traceContext, 'success');
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to mark session as MFA verified', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Get MFA status for a user
   */
  async getMfaStatus(userId: string): Promise<any[]> {
    const traceContext = observability.startTrace('auth.get_mfa_status');
    try {
      observability.setTraceTag(traceContext, 'user_id', userId);

      const { data, error } = await this.supabase
        .from('multi_factor_auth')
        .select('method, is_enabled, is_primary, verified_at, last_used_at')
        .eq('user_id', userId);

      if (error) throw error;

      observability.finishTrace(traceContext, 'success');
      return data || [];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to get MFA status', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Clean up expired sessions
   */
  private startPeriodicCleanup(): void {
    setInterval(async () => {
      try {
        await this.cleanupExpiredSessions();
      } catch (error) {
        console.error('Error during periodic session cleanup:', error);
      }
    }, this.config.session.cleanup_interval_hours * 60 * 60 * 1000);
  }
}

export const enhancedAuth = new EnhancedAuthService();