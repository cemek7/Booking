import { defaultLogger } from '@/lib/logger';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { normalizeInvitationEmail } from './tenant-invitations';

type ServerVerifiedEmailType = 'email' | 'recovery' | 'invite' | 'email_change';
type UnifiedAuthClient = ReturnType<typeof createSupabaseAdminClient>['auth'];
type VerifiedSession = Awaited<ReturnType<UnifiedAuthClient['verifyOtp']>>['data']['session'];

const SERVER_VERIFIED_EMAIL_TYPES = new Set<ServerVerifiedEmailType>([
  'email',
  'recovery',
  'invite',
  'email_change',
]);

type EmailTokenVerifier = {
  verifyOtp: UnifiedAuthClient['verifyOtp'];
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
): Promise<VerifiedSession | null> {
  if (!rawType || !SERVER_VERIFIED_EMAIL_TYPES.has(rawType as ServerVerifiedEmailType)) {
    throw new Error('Unsupported email verification type');
  }

  const { data, error } = await auth.verifyOtp({
    token_hash: tokenHash,
    type: rawType as ServerVerifiedEmailType,
  });

  if (error) throw error;
  return data.session;
}

export async function syncConfirmedLoginEmail(
  admin: ReturnType<typeof createSupabaseAdminClient>,
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
