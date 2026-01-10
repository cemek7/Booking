import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { enhancedAuth } from '@/lib/auth/enhanced-auth';
import { z } from 'zod';

// Validation schema for login
const LoginSchema = z.object({
  email: z.string().email({ message: 'Invalid email format' }),
  password: z.string().min(1, { message: 'Password cannot be empty' }),
  mfa_code: z.string().optional(),
  remember_me: z.boolean().default(false),
  device_fingerprint: z.string().optional(),
});

/**
 * Enhanced login endpoint with comprehensive security features
 * POST /api/auth/enhanced/login
 * 
 * Public endpoint (no authentication required)
 * Handles: email/password auth, MFA verification, session creation, rate limiting
 */
export const POST = createHttpHandler(
  async (ctx) => {
    enhancedAuth.setSupabaseClient(ctx.supabase);

  try {
    const body = await parseJsonBody(ctx.request);
    const { email, password, mfa_code, remember_me, device_fingerprint } = LoginSchema.parse(body);

    const clientInfo = {
      ip_address:
        ctx.request.headers.get('x-forwarded-for') ||
        ctx.request.headers.get('x-real-ip') ||
        '127.0.0.1',
      user_agent: ctx.request.headers.get('user-agent') || 'unknown',
      device_fingerprint,
    };

    // --- Rate Limiting ---
    const rateLimitResult = await enhancedAuth.checkRateLimit(
      clientInfo.ip_address,
      'login'
    );
    if (!rateLimitResult.allowed) {
      throw ApiErrorFactory.tooManyRequests(
        `Too many login attempts. Try again at ${rateLimitResult.resetTime}`
      );
    }

    // --- User & Account Status Check ---
    const { data: { users }, error: userError } = await ctx.supabase.auth.admin.listUsers();
    const user = users?.find(u => u.email === email);

    if (userError || !user) {
      await enhancedAuth.logAuthEvent({
        user_id: 'unknown',
        event_type: 'login_failed',
        success: false,
        failure_reason: 'user_not_found',
        ip_address: clientInfo.ip_address,
        user_agent: clientInfo.user_agent,
      });
      throw ApiErrorFactory.invalidCredentials();
    }

    const lockoutStatus = await enhancedAuth.checkAccountLockout(user.id);
    if (lockoutStatus.isLocked) {
      throw ApiErrorFactory.accountLocked(
        `Account locked until ${lockoutStatus.unlockAt}`
      );
    }

    // --- Password Authentication ---
    const { data: authData, error: authError } = await ctx.supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.user) {
      await enhancedAuth.logAuthEvent({
        user_id: user.id,
        event_type: 'login_failed',
        success: false,
        failure_reason: 'invalid_credentials',
        ip_address: clientInfo.ip_address,
        user_agent: clientInfo.user_agent,
      });
      throw ApiErrorFactory.invalidCredentials();
    }

    // --- MFA Verification ---
    const { data: mfaConfigs } = await ctx.supabase
      .from('multi_factor_auth')
      .select('id, method, is_enabled')
      .eq('user_id', authData.user.id)
      .eq('is_enabled', true);

    const hasMFA = mfaConfigs && mfaConfigs.length > 0;
    let mfaVerified = false;

    if (hasMFA) {
      if (!mfa_code) {
        // MFA is required, but no code provided
        return {
          success: true,
          mfa_required: true,
          mfa_verified: false,
          message: 'MFA code required',
          user: {
            id: authData.user.id,
            email: authData.user.email,
          },
        };
      }

      const mfaResult = await enhancedAuth.verifyMFA({
        user_id: authData.user.id,
        method: mfaConfigs[0].method,
        code: mfa_code,
      });

      mfaVerified = mfaResult.verified;

      if (!mfaVerified) {
        throw ApiErrorFactory.invalidToken(
          `Invalid MFA code. ${mfaResult.remainingAttempts} attempts remaining`
        );
      }
    }

    // --- Session Creation ---
    const sessionDuration = remember_me ? 30 * 24 * 60 : 8 * 60; // 30 days or 8 hours
    const session = await enhancedAuth.createSession({
      user_id: authData.user.id,
      ip_address: clientInfo.ip_address,
      user_agent: clientInfo.user_agent,
      device_fingerprint: clientInfo.device_fingerprint,
      expires_in_minutes: sessionDuration,
    });

    // --- Logging ---
    await enhancedAuth.logAuthEvent({
      user_id: authData.user.id,
      event_type: 'login',
      success: true,
      ip_address: clientInfo.ip_address,
      user_agent: clientInfo.user_agent,
      session_id: session?.id,
      metadata: {
        mfa_verified,
        remember_me,
        session_duration_minutes: sessionDuration,
      },
    });

    return {
      success: true,
      user: {
        id: authData.user.id,
        email: authData.user.email,
      },
      session: {
        id: session?.id,
        token: session?.session_token,
        expires_at: session?.expires_at,
      },
      mfa_required: hasMFA,
      mfa_verified,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw ApiErrorFactory.validationError(
        `Invalid request body: ${error.issues[0].message}`
      );
    }
    throw error;
  }
},
'POST',
{ auth: false }  // Public endpoint
);