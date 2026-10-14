import { createHash, randomBytes } from 'node:crypto';

export type InvitationErrorCode =
  | 'invite_invalid'
  | 'invite_expired'
  | 'invite_consumed'
  | 'invite_email_mismatch'
  | 'invite_membership_conflict'
  | 'invite_forbidden';

export class InvitationError extends Error {
  constructor(public readonly code: InvitationErrorCode) {
    super(code);
    this.name = 'InvitationError';
  }
}

export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashInvitationToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function generateInvitationToken(): {
  rawToken: string;
  tokenHash: string;
} {
  const rawToken = randomBytes(32).toString('base64url');
  return { rawToken, tokenHash: hashInvitationToken(rawToken) };
}

export function maskInvitationEmail(email: string): string {
  const normalized = normalizeInvitationEmail(email);
  const separator = normalized.lastIndexOf('@');
  if (separator <= 0 || separator === normalized.length - 1) return '***';
  return `${normalized[0]}***@${normalized.slice(separator + 1)}`;
}

export function assertInvitationRoleAllowed(
  actorRole: string,
  invitedRole: string
): asserts invitedRole is 'manager' | 'staff' {
  const actor = actorRole.trim().toLowerCase();
  const invited = invitedRole.trim().toLowerCase();
  const allowed =
    (actor === 'owner' && (invited === 'manager' || invited === 'staff')) ||
    (actor === 'manager' && invited === 'staff');

  if (!allowed) throw new InvitationError('invite_forbidden');
}

export function assertInvitationDomainAllowed(
  email: string,
  allowedDomains: string[]
): void {
  if (allowedDomains.length === 0) return;

  const normalized = normalizeInvitationEmail(email);
  const separator = normalized.lastIndexOf('@');
  if (separator <= 0 || separator === normalized.length - 1) {
    throw new InvitationError('invite_forbidden');
  }

  const emailDomain = normalized.slice(separator + 1);
  const matches = allowedDomains.some((value) => {
    const allowed = value.trim().toLowerCase().replace(/^@/, '').replace(/^\.+|\.+$/g, '');
    return allowed !== '' && (emailDomain === allowed || emailDomain.endsWith(`.${allowed}`));
  });

  if (!matches) throw new InvitationError('invite_forbidden');
}
