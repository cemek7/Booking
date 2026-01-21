import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';
import { webcrypto as crypto } from 'crypto';
import { observability } from '../../observability/observability';
import type { UserSession } from '@/types/auth';

export const SessionCreateSchema = z.object({
  user_id: z.string().uuid(),
  ip_address: z.string().optional(),
  user_agent: z.string().optional(),
  device_fingerprint: z.string().optional(),
  expires_in_minutes: z.number().default(480),
});

interface SessionConfig {
  default_timeout_minutes: number;
  max_concurrent_sessions: number;
  cleanup_interval_hours: number;
}

/**
 * Service for user session management
 */
export class SessionService {
  private supabase: SupabaseClient;
  private cleanupInterval: NodeJS.Timeout | null = null;

  private config: SessionConfig = {
    default_timeout_minutes: 480,
    max_concurrent_sessions: 5,
    cleanup_interval_hours: 1,
  };

  constructor(supabase: SupabaseClient, config?: Partial<SessionConfig>) {
    this.supabase = supabase;
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  /**
   * Create a new session
   */
  async createSession(data: z.infer<typeof SessionCreateSchema>): Promise<UserSession> {
    const traceContext = observability.startTrace('session.create');

    try {
      const validatedData = SessionCreateSchema.parse(data);
      observability.setTraceTag(traceContext, 'user_id', validatedData.user_id);

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
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;

      observability.recordBusinessMetric('session_created_total', 1);
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
        metadata: session.metadata,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to create session', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Get session by token
   */
  async getSession(sessionToken: string): Promise<UserSession | null> {
    const traceContext = observability.startTrace('session.get');
    try {
      observability.setTraceTag(traceContext, 'session_token', sessionToken.substring(0, 8) + '...');

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
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Get active sessions for a user
   */
  async getActiveSessions(userId: string): Promise<UserSession[]> {
    const traceContext = observability.startTrace('session.get_active');
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
   * Terminate a specific session
   */
  async terminateSession(sessionId: string, reason: string): Promise<{ success: boolean }> {
    const traceContext = observability.startTrace('session.terminate');
    try {
      observability.setTraceTag(traceContext, 'session_id', sessionId);

      const { error } = await this.supabase
        .from('user_sessions')
        .update({
          is_active: false,
          force_logout: true,
          logout_reason: reason,
        })
        .eq('id', sessionId)
        .eq('is_active', true);

      if (error) throw error;

      observability.recordBusinessMetric('session_terminated_total', 1, { reason });
      observability.finishTrace(traceContext, 'success');
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to terminate session', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Terminate all sessions for a user
   */
  async terminateAllUserSessions(
    userId: string,
    reason: string
  ): Promise<{ success: boolean; terminated_sessions: number }> {
    const traceContext = observability.startTrace('session.terminate_all');
    try {
      observability.setTraceTag(traceContext, 'user_id', userId);

      const { data, error } = await this.supabase
        .from('user_sessions')
        .update({
          is_active: false,
          force_logout: true,
          logout_reason: reason,
        })
        .eq('user_id', userId)
        .eq('is_active', true)
        .select();

      if (error) throw error;

      observability.recordBusinessMetric('session_all_terminated_total', 1, { reason });
      observability.finishTrace(traceContext, 'success');
      return { success: true, terminated_sessions: data?.length || 0 };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to terminate all sessions', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupExpiredSessions(): Promise<{ cleaned: number }> {
    const traceContext = observability.startTrace('session.cleanup');

    try {
      const { data, error } = await this.supabase.rpc('cleanup_expired_sessions');

      if (error) throw error;

      const cleaned = Array.isArray(data) ? data.length : 0;
      observability.recordBusinessMetric('session_cleanup_total', cleaned, { reason: 'expired' });
      observability.finishTrace(traceContext, 'success');

      return { cleaned };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to cleanup sessions', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Start periodic cleanup of expired sessions
   */
  startPeriodicCleanup(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(
      async () => {
        try {
          await this.cleanupExpiredSessions();
        } catch (error) {
          console.error('Error during periodic session cleanup:', error);
        }
      },
      this.config.cleanup_interval_hours * 60 * 60 * 1000
    );
  }

  /**
   * Stop periodic cleanup
   */
  stopPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  // Private helper methods

  private generateSecureToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
