import type { EmailOtpType, Session } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { defaultLogger } from '@/lib/logger';
import { normalizeInvitationEmail } from './tenant-invitations';

const SERVER_VERIFIED_EMAIL_TYPES = new Set<EmailOtpType>([
  'email',
  'recovery',
  'invite',
  'email_change',
]);

type EmailTokenVerifier = {
  verifyOtp(params: {
    token_hash: string;
    type: EmailOtpType;
  }): Promise<{
    data: { session: Session | null };
    error: { message: string } | null;
  }>;
};

export function buildEmailTokenExchangeUrl(currentUrl: string): string | null {
  const url = new URL(currentUrl);
  if (!url.searchParams.get('token_hash')) return null;
  url.pathname = '/api/auth/callback';
  return url.toString();
}

export async function verifyEmailTokenHash(
  auth: EmailTokenVerifier,
  tokenHash: string,
  rawType: string | null,
): Promise<Session | null> {
  if (!rawType || !SERVER_VERIFIED_EMAIL_TYPES.has(rawType as EmailOtpType)) {
    throw new Error('Unsupported email verification type');
  }

  const { data, error } = await auth.verifyOtp({
    token_hash: tokenHash,
    type: rawType as EmailOtpType,
  });

  if (error) throw error;
  return data.session;
}

export async function syncConfirmedLoginEmail(
  admin: SupabaseClient,
  user: { id?: string | null; email?: string | null } | null | undefined,
  rawType: string | null
): Promise<void> {
  if (rawType !== 'email_change') return;
  if (!user?.id || !user.email) throw new Error('email_change_session_missing');

  const email = normalizeInvitationEmail(user.email);
  const { error } = await admin
    .from('tenant_users')
    .update({ email })
    .eq('user_id', user.id);

  if (error) {
    defaultLogger.error('Confirmed login email membership sync failed', {
      userId: user.id,
      event: 'login_email_sync_failed',
    });
    throw new Error('email_membership_sync_failed');
  }

  defaultLogger.info('Confirmed login email synchronized', {
    userId: user.id,
    event: 'login_email_sync_succeeded',
  });
}
