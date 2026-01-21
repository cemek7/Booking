import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';
import { observability } from '../../observability/observability';

export const SecuritySettingsSchema = z.object({
  user_id: z.string().uuid(),
  mfa_required: z.boolean().optional(),
  session_timeout_minutes: z.number().min(5).max(43200).optional(),
  max_concurrent_sessions: z.number().min(1).max(10).optional(),
  password_expiry_days: z.number().min(30).max(365).optional(),
  allowed_ip_ranges: z.array(z.string()).optional(),
  security_questions: z
    .array(
      z.object({
        question: z.string(),
        answer_hash: z.string(),
      })
    )
    .optional(),
});

interface RateLimitResult {
  allowed: boolean;
  resetTime?: Date;
}

interface LockoutStatus {
  isLocked: boolean;
  lockoutReason?: string;
  lockedAt?: Date;
  unlockAt?: Date;
  attemptsRemaining?: number;
}

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

interface AuthLog {
  event_type: string;
  ip_address: string | null;
  success: boolean;
  created_at: string;
  failure_reason: string | null;
}

/**
 * Service for security operations: rate limiting, lockouts, security metrics
 */
export class SecurityService {
  private supabase: SupabaseClient;

  private config = {
    max_failed_attempts: 5,
    lockout_duration_minutes: 15,
    password_min_length: 12,
    password_history_count: 5,
  };

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Check rate limit for a given action and identifier
   */
  async checkRateLimit(identifier: string, action: string): Promise<RateLimitResult> {
    const traceContext = observability.startTrace('security.check_rate_limit');
    try {
      observability.setTraceTag(traceContext, 'identifier', identifier);
      observability.setTraceTag(traceContext, 'action', action);

      const { data, error } = await this.supabase.rpc('check_rate_limit', {
        p_identifier: identifier,
        p_action: action,
      });

      if (error) throw error;

      const result = data?.[0] || { allowed: true };

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
  async checkAccountLockout(userId: string): Promise<LockoutStatus> {
    const traceContext = observability.startTrace('security.check_lockout');

    try {
      observability.setTraceTag(traceContext, 'user_id', userId);

      const { data, error } = await this.supabase.rpc('check_account_lockout', {
        p_user_id: userId,
      });

      if (error) throw error;

      const result = data?.[0] || {
        is_locked: false,
        lockout_reason: null,
        locked_at: null,
        unlock_at: null,
        attempts_remaining: 5,
      };

      observability.finishTrace(traceContext, 'success');

      return {
        isLocked: result.is_locked,
        lockoutReason: result.lockout_reason,
        lockedAt: result.locked_at ? new Date(result.locked_at) : undefined,
        unlockAt: result.unlock_at ? new Date(result.unlock_at) : undefined,
        attemptsRemaining: result.attempts_remaining,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to check lockout', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Lock a user account
   */
  async lockUserAccount(
    userId: string,
    reason: string,
    durationMinutes: number = 15,
    lockedBy?: string
  ): Promise<string> {
    const traceContext = observability.startTrace('security.lock_account');

    try {
      observability.setTraceTag(traceContext, 'user_id', userId);
      observability.setTraceTag(traceContext, 'reason', reason);

      const { data, error } = await this.supabase.rpc('lock_user_account', {
        p_user_id: userId,
        p_reason: reason,
        p_duration_minutes: durationMinutes,
        p_locked_by: lockedBy,
      });

      if (error) throw error;

      observability.recordBusinessMetric('account_locked_total', 1, { reason });
      observability.finishTrace(traceContext, 'success');

      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to lock account', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Unlock a user account
   */
  async unlockUserAccount(userId: string, unlockedBy?: string): Promise<{ success: boolean }> {
    const traceContext = observability.startTrace('security.unlock_account');

    try {
      observability.setTraceTag(traceContext, 'user_id', userId);

      const { error } = await this.supabase.rpc('unlock_user_account', {
        p_user_id: userId,
        p_unlocked_by: unlockedBy,
      });

      if (error) throw error;

      observability.recordBusinessMetric('account_unlocked_total', 1);
      observability.finishTrace(traceContext, 'success');

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to unlock account', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Get security metrics for a user
   */
  async getUserSecurityMetrics(userId: string, daysBack: number = 30): Promise<SecurityMetrics> {
    const traceContext = observability.startTrace('security.get_metrics');

    try {
      observability.setTraceTag(traceContext, 'user_id', userId);

      const { data, error } = await this.supabase.rpc('get_user_security_metrics', {
        p_user_id: userId,
        p_days_back: daysBack,
      });

      if (error) throw error;

      observability.finishTrace(traceContext, 'success');

      return {
        login_count: data?.login_count || 0,
        failed_login_count: data?.failed_login_count || 0,
        unique_ips: data?.unique_ips || 0,
        unique_devices: data?.unique_devices || 0,
        mfa_verifications: data?.mfa_verifications || 0,
        password_changes: data?.password_changes || 0,
        lockout_events: data?.lockout_events || 0,
        last_login: data?.last_login ? new Date(data.last_login) : undefined,
        suspicious_activity_score: data?.suspicious_activity_score || 'low',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to get security metrics', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Get recent authentication logs for a user
   */
  async getRecentAuthLogs(userId: string, limit: number = 10): Promise<AuthLog[]> {
    const traceContext = observability.startTrace('security.get_auth_logs');
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
      observability.addTraceLog(traceContext, 'error', 'Failed to get auth logs', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }
}
