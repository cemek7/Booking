import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { enhancedAuth } from '@/lib/auth/enhanced-auth';
import { z } from 'zod';

const SecuritySettingsSchema = z.object({
  mfa_required: z.boolean().optional(),
  session_timeout_minutes: z.number().min(5).max(43200).optional(),
  max_concurrent_sessions: z.number().min(1).max(10).optional(),
  password_expiry_days: z.number().min(30).max(365).optional(),
  allowed_ip_ranges: z.array(z.string()).optional(),
});

/**
 * Get user security settings, metrics, and activity
 * GET /api/auth/enhanced/security
 */
export const GET = createHttpHandler(
  async (ctx) => {
    if (!ctx.user?.id) {
      throw ApiErrorFactory.missingAuthorization();
    }

    enhancedAuth.setSupabaseClient(ctx.supabase);

    // Fetch security data
    const [settings, metrics, activeSessions, recentLogs] = await Promise.all([
      ctx.supabase
        .from('security_settings')
        .select('*')
        .eq('user_id', ctx.user.id)
        .maybeSingle(),

      enhancedAuth.getUserSecurityMetrics(ctx.user.id),

      ctx.supabase
        .from('user_sessions')
        .select('id, ip_address, user_agent, created_at, last_activity')
        .eq('user_id', ctx.user.id)
        .eq('is_active', true)
        .order('last_activity', { ascending: false }),

      ctx.supabase
        .from('user_authentication_logs')
        .select('event_type, ip_address, success, created_at, failure_reason')
        .eq('user_id', ctx.user.id)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    return {
      settings: settings.data || {
        mfa_required: false,
        session_timeout_minutes: 480,
        max_concurrent_sessions: 5,
        password_expiry_days: 90,
        allowed_ip_ranges: [],
      },
      metrics,
      active_sessions: activeSessions.data || [],
      recent_activity: recentLogs.data || [],
    };
  },
  'GET',
  { auth: true }
);

/**
 * Update user security settings
 * PATCH /api/auth/enhanced/security
 */
export const PATCH = createHttpHandler(
  async (ctx) => {
    if (!ctx.user?.id) {
      throw ApiErrorFactory.missingAuthorization();
    }

    enhancedAuth.setSupabaseClient(ctx.supabase);

    const body = await ctx.request.json();
    const validation = SecuritySettingsSchema.safeParse(body);

    if (!validation.success) {
      throw ApiErrorFactory.validationError(
        `Invalid security settings: ${validation.error.issues[0].message}`
      );
    }

    const settings = validation.data;

    // Update settings
    try {
      await ctx.supabase
        .from('security_settings')
        .upsert({
          user_id: ctx.user.id,
          ...settings,
          updated_at: new Date().toISOString(),
        });

      // Log security settings change
      await enhancedAuth.logAuthEvent({
        user_id: ctx.user.id,
        event_type: 'security_settings_change',
        success: true,
        metadata: {
          action: 'security_settings_updated',
          changes: Object.keys(settings),
        },
      });

      return {
        success: true,
        message: 'Security settings updated successfully',
        settings,
      };
    } catch (error) {
      console.error('[auth/security] settings update failed:', error);
      throw ApiErrorFactory.internalServerError('Failed to update security settings');
    }
  },
  'PATCH',
  { auth: true }
);

/**
 * Terminate a specific session for the current user
 * DELETE /api/auth/enhanced/security/[sessionId]
 */
export const DELETE = createHttpHandler(
  async (ctx) => {
    if (!ctx.user?.id) {
      throw ApiErrorFactory.missingAuthorization();
    }

    const sessionIdToTerminate = ctx.params?.sessionId;

    if (!sessionIdToTerminate) {
      throw ApiErrorFactory.validationError('Session ID is required');
    }

    enhancedAuth.setSupabaseClient(ctx.supabase);

    // Verify ownership of session
    const { data: targetSession, error: targetSessionError } = await ctx.supabase
      .from('user_sessions')
      .select('user_id')
      .eq('id', sessionIdToTerminate)
      .maybeSingle();

    if (targetSessionError || !targetSession) {
      throw ApiErrorFactory.notFound('Session not found');
    }

    if (targetSession.user_id !== ctx.user.id) {
      // Log security incident
      await enhancedAuth.logAuthEvent({
        user_id: ctx.user.id,
        event_type: 'unauthorized_action',
        success: false,
        failure_reason: 'unauthorized_session_termination_attempt',
        metadata: { target_session_id: sessionIdToTerminate },
      });

      throw ApiErrorFactory.forbidden('Cannot terminate another user\'s session');
    }

    // Terminate the session
    try {
      await enhancedAuth.terminateSession(sessionIdToTerminate, 'user_initiated_remote_logout');

      return {
        success: true,
        message: `Session ${sessionIdToTerminate} terminated`,
      };
    } catch (error) {
      console.error('[auth/security] session termination failed:', error);
      throw ApiErrorFactory.internalServerError('Failed to terminate session');
    }
  },
  'DELETE',
  { auth: true }
);