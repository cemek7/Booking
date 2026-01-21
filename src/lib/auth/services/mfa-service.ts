import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { webcrypto as crypto } from 'crypto';
import { observability } from '../../observability/observability';

export const MFASetupSchema = z.object({
  user_id: z.string().uuid(),
  method: z.enum(['totp', 'sms', 'email']),
  phone_number: z.string().optional(),
  email: z.string().email().optional(),
});

export const MFAVerificationSchema = z.object({
  user_id: z.string().uuid(),
  method: z.enum(['totp', 'sms', 'email', 'backup_codes']),
  code: z.string(),
  session_id: z.string().optional(),
});

interface MFAConfig {
  id: string;
  user_id: string;
  method: string;
  is_enabled: boolean;
  secret_encrypted: string;
  backup_codes_encrypted: string;
  failure_count: number;
  blocked_until: string | null;
  verified_at: string | null;
}

interface MFAVerificationResult {
  verified: boolean;
  remainingAttempts?: number;
  isBackupCode?: boolean;
}

interface MFASetupResult {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

interface MFAStatus {
  method: string;
  is_enabled: boolean;
  is_primary: boolean;
  verified_at: string | null;
  last_used_at: string | null;
}

/**
 * Service for Multi-Factor Authentication operations
 */
export class MFAService {
  private supabase: SupabaseClient;
  private encryptionKey: string;

  private config = {
    service_name: process.env.TOTP_SERVICE_NAME || 'BookingSystem',
    window: 2,
    step: 30,
    backup_codes_count: 10,
    max_failure_attempts: 5,
    block_duration_minutes: 30,
  };

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.encryptionKey = process.env.MFA_ENCRYPTION_KEY || 'default-key-change-in-production';
  }

  /**
   * Set up TOTP MFA for user
   */
  async setupTOTP(userId: string): Promise<MFASetupResult> {
    const traceContext = observability.startTrace('mfa.setup_totp');

    try {
      observability.setTraceTag(traceContext, 'user_id', userId);

      // Generate TOTP secret
      const secret = authenticator.generateSecret();

      // Get user info for QR code
      const { data: user } = await this.supabase.auth.admin.getUserById(userId);
      if (!user?.user) throw new Error('User not found');

      // Generate QR code URL
      const otpauthUrl = authenticator.keyuri(
        user.user.email!,
        this.config.service_name,
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
          is_enabled: false,
          secret_encrypted: encryptedSecret,
          backup_codes_encrypted: encryptedBackupCodes,
        });

      if (error) throw error;

      observability.recordBusinessMetric('mfa_setup_total', 1, { method: 'totp' });
      observability.finishTrace(traceContext, 'success');

      return { secret, qrCodeUrl, backupCodes };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to setup TOTP', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Verify MFA code
   */
  async verifyMFA(
    data: z.infer<typeof MFAVerificationSchema>,
    logAuthEvent: (event: { user_id: string; event_type: string; success: boolean; failure_reason?: string; session_id?: string; metadata?: Record<string, unknown> }) => Promise<string>
  ): Promise<MFAVerificationResult> {
    const traceContext = observability.startTrace('mfa.verify');

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
          verified = this.verifyTOTPCode(mfaConfig as MFAConfig, validatedData.code);
          break;
        case 'backup_codes':
          const result = await this.verifyBackupCode(mfaConfig as MFAConfig, validatedData.code);
          verified = result.verified;
          isBackupCode = true;
          break;
        default:
          throw new Error(`MFA method ${validatedData.method} not supported`);
      }

      // Log verification attempt
      await this.supabase.from('mfa_verification_attempts').insert({
        user_id: validatedData.user_id,
        mfa_id: mfaConfig.id,
        method: validatedData.method,
        code_provided: validatedData.code.substring(0, 4) + '***',
        success: verified,
        failure_reason: verified ? null : 'Invalid code',
      });

      let newFailureCount = mfaConfig.failure_count;

      if (verified) {
        // Update MFA record
        await this.supabase
          .from('multi_factor_auth')
          .update({
            last_used_at: new Date().toISOString(),
            failure_count: 0,
            blocked_until: null,
          })
          .eq('id', mfaConfig.id);

        // Enable MFA if first successful verification
        if (!mfaConfig.verified_at) {
          await this.supabase
            .from('multi_factor_auth')
            .update({
              verified_at: new Date().toISOString(),
              is_enabled: true,
            })
            .eq('id', mfaConfig.id);
        }

        await logAuthEvent({
          user_id: validatedData.user_id,
          event_type: 'mfa_verify',
          success: true,
          session_id: validatedData.session_id,
          metadata: { method: validatedData.method, is_backup_code: isBackupCode },
        });
      } else {
        newFailureCount = mfaConfig.failure_count + 1;
        const updates: Record<string, unknown> = { failure_count: newFailureCount };

        if (newFailureCount >= this.config.max_failure_attempts) {
          updates.blocked_until = new Date(
            Date.now() + this.config.block_duration_minutes * 60 * 1000
          );
        }

        await this.supabase.from('multi_factor_auth').update(updates).eq('id', mfaConfig.id);

        await logAuthEvent({
          user_id: validatedData.user_id,
          event_type: 'mfa_failed',
          success: false,
          failure_reason: 'invalid_code',
          session_id: validatedData.session_id,
          metadata: {
            method: validatedData.method,
            remaining_attempts: this.config.max_failure_attempts - newFailureCount,
          },
        });
      }

      observability.finishTrace(traceContext, 'success');

      return {
        verified,
        remainingAttempts: this.config.max_failure_attempts - (verified ? 0 : newFailureCount),
        isBackupCode,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to verify MFA', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Get MFA status for a user
   */
  async getMfaStatus(userId: string): Promise<MFAStatus[]> {
    const traceContext = observability.startTrace('mfa.get_status');
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
   * Mark session as MFA verified
   */
  async markSessionAsMfaVerified(sessionId: string): Promise<{ success: boolean }> {
    const traceContext = observability.startTrace('mfa.mark_session_verified');
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
            ...(session.metadata as Record<string, unknown>),
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

  // Private helper methods

  private verifyTOTPCode(mfaConfig: MFAConfig, code: string): boolean {
    const secret = this.decrypt(mfaConfig.secret_encrypted);
    return authenticator.verify({ token: code, secret });
  }

  private async verifyBackupCode(
    mfaConfig: MFAConfig,
    code: string
  ): Promise<{ verified: boolean }> {
    const backupCodes = JSON.parse(this.decrypt(mfaConfig.backup_codes_encrypted)) as string[];
    const codeIndex = backupCodes.indexOf(code);

    if (codeIndex === -1) {
      return { verified: false };
    }

    // Remove used backup code
    backupCodes.splice(codeIndex, 1);
    const encryptedBackupCodes = this.encrypt(JSON.stringify(backupCodes));

    await this.supabase
      .from('multi_factor_auth')
      .update({ backup_codes_encrypted: encryptedBackupCodes })
      .eq('id', mfaConfig.id);

    return { verified: true };
  }

  private generateBackupCodes(count: number = 10): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const code = Array.from(crypto.getRandomValues(new Uint8Array(4)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
      codes.push(code);
    }
    return codes;
  }

  private encrypt(text: string): string {
    // Simple base64 encoding for now - in production, use proper encryption
    return Buffer.from(text).toString('base64');
  }

  private decrypt(encrypted: string): string {
    return Buffer.from(encrypted, 'base64').toString('utf-8');
  }
}
