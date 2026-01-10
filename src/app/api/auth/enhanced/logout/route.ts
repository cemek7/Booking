import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { enhancedAuth } from '@/lib/auth/enhanced-auth';

/**
 * Logout the current session
 * POST /api/auth/enhanced/logout
 */
export const POST = createHttpHandler(
  async (ctx) => {
    enhancedAuth.setSupabaseClient(ctx.supabase);

    const sessionToken =
      ctx.request.headers.get('authorization')?.replace('Bearer ', '') ||
      ctx.request.cookies.get('session_token')?.value;

    if (!sessionToken) {
      // If no token, client should clear its cookie
      return {
        success: true,
        message: 'Session cleared',
      };
    }

    // Get and terminate session
    try {
      const session = await enhancedAuth.getSession(sessionToken);
      if (session) {
        await enhancedAuth.terminateSession(session.id, 'user_initiated');
      }
    } catch (error) {
      console.error('[auth/logout] session termination failed:', error);
      // Don't fail the logout if session termination fails
    }

    return {
      success: true,
      message: 'Logged out successfully',
    };
  },
  'POST',
  { auth: false } // Public endpoint - user may not have valid token
);

/**
 * Logout from all sessions for the current user
 * DELETE /api/auth/enhanced/logout
 */
export const DELETE = createHttpHandler(
  async (ctx) => {
    enhancedAuth.setSupabaseClient(ctx.supabase);

    const sessionToken =
      ctx.request.headers.get('authorization')?.replace('Bearer ', '') ||
      ctx.request.cookies.get('session_token')?.value;

    if (!sessionToken) {
      throw ApiErrorFactory.missingAuthorization();
    }

    // Get current session to identify the user
    const currentSession = await enhancedAuth.getSession(sessionToken);

    if (!currentSession) {
      throw ApiErrorFactory.invalidToken();
    }

    // Terminate all sessions for this user
    try {
      const result = await enhancedAuth.terminateAllUserSessions(
        currentSession.user_id,
        'user_initiated_global_logout'
      );

      console.log(
        `[auth/logout] User ${currentSession.user_id} logged out of ${result?.terminated_sessions ?? 1} sessions`
      );

      return {
        success: true,
        message: 'Logged out from all sessions',
        sessions_terminated: result?.terminated_sessions ?? 1,
      };
    } catch (error) {
      console.error('[auth/logout] global logout failed:', error);
      throw ApiErrorFactory.internalServerError('Failed to logout from all sessions');
    }
  },
  'DELETE',
  { auth: false }
);