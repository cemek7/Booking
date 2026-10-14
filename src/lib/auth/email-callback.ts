import type { EmailOtpType, Session } from '@supabase/supabase-js';

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
