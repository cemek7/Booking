import {
  INVITATION_COOKIE_NAME,
  buildInvitationCookieOptions,
  isValidInvitationToken,
} from './invitation-cookie';

describe('invitation cookie helpers', () => {
  it('uses one stable cookie name and accepts only 32-byte base64url tokens', () => {
    expect(INVITATION_COOKIE_NAME).toBe('booka_tenant_invitation');
    expect(isValidInvitationToken('a'.repeat(43))).toBe(true);
    expect(isValidInvitationToken('short')).toBe(false);
    expect(isValidInvitationToken(`${'a'.repeat(42)}+`)).toBe(false);
  });

  it('creates a hardened cookie capped by the invitation lifetime', () => {
    const options = buildInvitationCookieOptions(
      '2026-10-16T12:00:00.000Z',
      new Date('2026-10-14T12:00:00.000Z'),
      true
    );

    expect(options).toEqual(expect.objectContaining({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 2 * 24 * 60 * 60,
    }));
  });

  it('never keeps a cookie longer than seven days', () => {
    const options = buildInvitationCookieOptions(
      '2026-11-14T12:00:00.000Z',
      new Date('2026-10-14T12:00:00.000Z'),
      false
    );

    expect(options.maxAge).toBe(7 * 24 * 60 * 60);
    expect(options.secure).toBe(false);
  });
});
