import {
  InvitationIssueError,
  issueTenantInvitation,
  type InvitationStore,
} from './issue-tenant-invitation';

function createStore(overrides: Partial<InvitationStore> = {}): InvitationStore {
  return {
    getTenantPolicy: jest.fn().mockResolvedValue({
      name: 'Studio One',
      settings: {
        allowedInviterRoles: ['owner', 'manager'],
        allowInvitesFromStaffPage: true,
        disablePublicInvites: false,
        allowedEmailDomains: [],
      },
    }),
    hasAuthenticatedMembership: jest.fn().mockResolvedValue(false),
    revokePending: jest.fn().mockResolvedValue(undefined),
    createInvitation: jest.fn().mockResolvedValue({
      id: 'invite-1',
      expiresAt: '2026-10-21T12:00:00.000Z',
    }),
    revokeInvitation: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const baseInput = {
  tenantId: 'tenant-1',
  actorUserId: 'user-1',
  actorRole: 'owner' as const,
  actorEmail: 'owner@example.com',
  invitedEmail: ' STAFF@EXAMPLE.COM ',
  invitedRole: 'staff' as const,
  publicOrigin: 'https://staging.app.techclave.cloud',
  source: 'dashboard' as const,
};

describe('issueTenantInvitation', () => {
  it('stores a hash, emails the raw token, and returns no secret', async () => {
    const store = createStore();
    const sendInvite = jest.fn().mockResolvedValue({ success: true, messageId: 'message-1' });
    const recordEvent = jest.fn().mockResolvedValue(undefined);
    const result = await issueTenantInvitation(baseInput, {
      store,
      sendInvite,
      recordEvent,
      now: () => new Date('2026-10-14T12:00:00.000Z'),
    });

    const created = (store.createInvitation as jest.Mock).mock.calls[0][0];
    const email = sendInvite.mock.calls[0][0];
    const inviteUrl = new URL(email.inviteUrl);
    const rawToken = inviteUrl.searchParams.get('token');

    expect(created).toMatchObject({
      tenantId: 'tenant-1',
      email: 'staff@example.com',
      role: 'staff',
      invitedBy: 'user-1',
      expiresAt: '2026-10-21T12:00:00.000Z',
    });
    expect(created.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.tokenHash).not.toBe(rawToken);
    expect(inviteUrl.origin).toBe('https://staging.app.techclave.cloud');
    expect(result).toEqual({
      ok: true,
      email_sent: true,
      expires_at: '2026-10-21T12:00:00.000Z',
    });
    expect(JSON.stringify(result)).not.toContain(String(rawToken));
    expect(JSON.stringify(recordEvent.mock.calls)).not.toContain(String(rawToken));
  });

  it('enforces manager-to-staff only', async () => {
    await expect(
      issueTenantInvitation(
        { ...baseInput, actorRole: 'manager', invitedRole: 'manager' },
        { store: createStore(), sendInvite: jest.fn() }
      )
    ).rejects.toEqual(new InvitationIssueError('invite_forbidden', 403));
  });

  it('enforces disabled invitation and domain settings', async () => {
    const disabled = createStore({
      getTenantPolicy: jest.fn().mockResolvedValue({
        name: 'Studio One',
        settings: { allowInvitesFromStaffPage: false },
      }),
    });
    await expect(
      issueTenantInvitation(baseInput, { store: disabled, sendInvite: jest.fn() })
    ).rejects.toEqual(new InvitationIssueError('invite_disabled', 403));

    const restricted = createStore({
      getTenantPolicy: jest.fn().mockResolvedValue({
        name: 'Studio One',
        settings: { allowedEmailDomains: ['company.test'] },
      }),
    });
    await expect(
      issueTenantInvitation(baseInput, { store: restricted, sendInvite: jest.fn() })
    ).rejects.toEqual(new InvitationIssueError('invite_domain_forbidden', 403));
  });

  it('rejects an existing authenticated tenant member', async () => {
    const store = createStore({
      hasAuthenticatedMembership: jest.fn().mockResolvedValue(true),
    });
    await expect(
      issueTenantInvitation(baseInput, { store, sendInvite: jest.fn() })
    ).rejects.toEqual(new InvitationIssueError('invite_already_member', 409));
  });

  it('revokes the newly-created invitation when delivery fails', async () => {
    const store = createStore();
    await expect(
      issueTenantInvitation(baseInput, {
        store,
        sendInvite: jest.fn().mockResolvedValue({ success: false, error: 'provider_down' }),
      })
    ).rejects.toEqual(new InvitationIssueError('invite_delivery_failed', 502));

    expect(store.revokeInvitation).toHaveBeenCalledWith('invite-1');
  });
});
