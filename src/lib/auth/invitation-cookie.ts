export const INVITATION_COOKIE_NAME = 'booka_tenant_invitation';

const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_INVITATION_COOKIE_AGE_SECONDS = 7 * 24 * 60 * 60;

export function isValidInvitationToken(value: unknown): value is string {
  return typeof value === 'string' && INVITATION_TOKEN_PATTERN.test(value);
}

export function buildInvitationCookieOptions(
  expiresAt: string,
  now = new Date(),
  secure = process.env.NODE_ENV === 'production'
) {
  const remainingSeconds = Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 1000)
  );

  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.min(MAX_INVITATION_COOKIE_AGE_SECONDS, remainingSeconds),
  };
}
