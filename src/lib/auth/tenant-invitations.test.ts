import {
  InvitationError,
  assertInvitationDomainAllowed,
  assertInvitationRoleAllowed,
  generateInvitationToken,
  hashInvitationToken,
  maskInvitationEmail,
  normalizeInvitationEmail,
} from './tenant-invitations';

describe('tenant invitation helpers', () => {
  it('generates an opaque base64url token and stores its SHA-256 hash', () => {
    const generated = generateInvitationToken();

    expect(generated.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generated.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(generated.tokenHash).toBe(hashInvitationToken(generated.rawToken));
    expect(generated.tokenHash).not.toContain(generated.rawToken);
  });

  it('hashes invitation tokens deterministically', () => {
    expect(hashInvitationToken('same-token')).toBe(hashInvitationToken('same-token'));
    expect(hashInvitationToken('same-token')).not.toBe(hashInvitationToken('other-token'));
  });

  it('normalizes and masks invitation email addresses', () => {
    expect(normalizeInvitationEmail('  Person.Name@Example.COM ')).toBe(
      'person.name@example.com'
    );
    expect(maskInvitationEmail('person.name@example.com')).toBe('p***@example.com');
    expect(maskInvitationEmail('a@example.com')).toBe('a***@example.com');
  });

  it.each([
    ['owner', 'manager'],
    ['owner', 'staff'],
    ['manager', 'staff'],
  ])('allows %s to invite %s', (actorRole, invitedRole) => {
    expect(() => assertInvitationRoleAllowed(actorRole, invitedRole)).not.toThrow();
  });

  it.each([
    ['manager', 'manager'],
    ['staff', 'staff'],
    ['staff', 'manager'],
    ['owner', 'owner'],
  ])('rejects %s inviting %s', (actorRole, invitedRole) => {
    expect(() => assertInvitationRoleAllowed(actorRole, invitedRole)).toThrow(
      new InvitationError('invite_forbidden')
    );
  });

  it('allows exact domains and their subdomains', () => {
    expect(() =>
      assertInvitationDomainAllowed('person@example.com', ['example.com'])
    ).not.toThrow();
    expect(() =>
      assertInvitationDomainAllowed('person@team.example.com', ['example.com'])
    ).not.toThrow();
  });

  it('rejects deceptive domain suffixes', () => {
    expect(() =>
      assertInvitationDomainAllowed('person@evil-example.com', ['example.com'])
    ).toThrow(new InvitationError('invite_forbidden'));
  });

  it('treats an empty domain list as unrestricted', () => {
    expect(() => assertInvitationDomainAllowed('person@anywhere.test', [])).not.toThrow();
  });
});
