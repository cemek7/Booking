import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';
import { enhancedAuth } from '@/lib/auth/enhanced-auth';

/**
 * GET,POST,PATCH /api/auth/enhanced/mfa
 *
 * GET: Get MFA status for the current user
 * POST: Initiate TOTP MFA setup
 * PATCH: Verify a TOTP or backup code
 */

const MfaVerifySchema = z.object({
  code: z.string().min(6, 'Code must be at least 6 characters'),
  method: z.enum(['totp', 'backup_codes']).default('totp'),
});

export const GET = createHttpHandler(
  async (ctx) => {
    // Get MFA status using the service
    const mfaConfigs = await enhancedAuth.getMfaStatus(ctx.user!.id);

    const isMfaEnabled = mfaConfigs.some((config) => config.is_enabled);

    return {
      success: true,
      mfa_enabled: isMfaEnabled,
      methods: mfaConfigs,
      session_mfa_verified: ctx.user!.metadata?.mfa_verified === true,
    };
  },
  'GET',
  { auth: true }
);

export const POST = createHttpHandler(
  async (ctx) => {
    // Setup TOTP using the service
    const totpSetup = await enhancedAuth.setupTOTP(ctx.user!.id);

    return {
      success: true,
      setup: {
        secret: totpSetup.secret,
        qr_code_url: totpSetup.qrCodeUrl,
        backup_codes: totpSetup.backupCodes,
      },
      instructions: [
        'Install an authenticator app (e.g., Google Authenticator, Authy).',
        'Scan the QR code or enter the secret manually.',
        'After setup, use the PATCH /api/auth/enhanced/mfa endpoint to verify your first code.',
        'Store your backup codes in a secure location.',
      ],
    };
  },
  'POST',
  { auth: true }
);

export const PATCH = createHttpHandler(
  async (ctx) => {
    const body = await parseJsonBody(ctx.request);
    const validation = MfaVerifySchema.safeParse(body);

    if (!validation.success) {
      throw ApiErrorFactory.validationError(
        Object.fromEntries(
          validation.error.issues.map((issue) => [
            issue.path.join('.') || '_',
            issue.message
          ])
        )
      );
    }

    const { code, method } = validation.data;

    // Verify MFA code using the service
    const mfaResult = await enhancedAuth.verifyMFA({
      user_id: ctx.user!.id,
      method,
      code,
      session_id: ctx.user!.sessionId || 'unknown',
    });

    if (!mfaResult.verified) {
      return {
        success: false,
        error: 'Invalid verification code',
        remaining_attempts: mfaResult.remainingAttempts,
      };
    }

    // Mark the current session as MFA-verified
    if (ctx.user!.sessionId) {
      await enhancedAuth.markSessionAsMfaVerified(ctx.user!.sessionId);
    }

    return {
      success: true,
      message: 'MFA verified successfully.',
      is_backup_code: mfaResult.isBackupCode,
    };
  },
  'PATCH',
  { auth: true }
);