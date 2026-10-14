const issueTenantInvitation = jest.fn();

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => ({ from: jest.fn() }),
}));
jest.mock('@/lib/booking/handlers/registry', () => ({
  dispatchValidate: jest.fn().mockResolvedValue({ handled: false }),
  dispatchExecute: jest.fn().mockResolvedValue({ handled: false }),
}));
jest.mock('@/lib/auth/issue-tenant-invitation', () => ({
  issueTenantInvitation: (...args: unknown[]) => issueTenantInvitation(...args),
}));
jest.mock('@/lib/http/public-origin', () => ({
  getConfiguredPublicOrigin: () => 'https://staging.app.techclave.cloud',
}));

import { executeAction, validateAction } from './action-validator';

const inviteAction = {
  action: 'invite_staff' as const,
  params: { name: 'Ada', email: 'ADA@example.com', role: 'staff' },
  reply: 'Invite Ada?',
  confidence: 'high' as const,
};

describe('v2 invite_staff action', () => {
  beforeEach(() => {
    issueTenantInvitation.mockReset().mockResolvedValue({
      ok: true,
      email_sent: true,
      expires_at: '2026-10-21T12:00:00.000Z',
    });
  });

  it('requires a name and valid email', async () => {
    await expect(validateAction('tenant-1', inviteAction)).resolves.toEqual({ valid: true });
    await expect(validateAction('tenant-1', {
      ...inviteAction,
      params: { name: 'Ada', email: 'not-an-email' },
    })).resolves.toMatchObject({ valid: false });
  });

  it('issues the same secure invitation after confirmation', async () => {
    await expect(executeAction('tenant-1', inviteAction, {
      actorId: 'tenant-user-1',
      actorUserId: 'auth-user-1',
      actorEmail: 'owner@example.com',
      userRole: 'owner',
      channel: 'whatsapp',
    })).resolves.toMatchObject({ success: true });

    expect(issueTenantInvitation).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      actorUserId: 'auth-user-1',
      actorRole: 'owner',
      invitedEmail: 'ADA@example.com',
      invitedRole: 'staff',
      publicOrigin: 'https://staging.app.techclave.cloud',
      source: 'whatsapp_v2',
    }));
  });

  it('requires a linked Supabase identity for the chat actor', async () => {
    await expect(executeAction('tenant-1', inviteAction, {
      actorId: 'tenant-user-1',
      actorUserId: null,
      userRole: 'owner',
      channel: 'whatsapp',
    })).resolves.toEqual({
      success: false,
      error: 'Connect your Booka login before sending account invitations.',
    });
    expect(issueTenantInvitation).not.toHaveBeenCalled();
  });

  it('does not allow staff to issue login invitations', async () => {
    await expect(executeAction('tenant-1', inviteAction, {
      actorId: 'tenant-user-1',
      actorUserId: 'auth-user-1',
      actorEmail: 'staff@example.com',
      userRole: 'staff',
      channel: 'whatsapp',
    })).resolves.toEqual({
      success: false,
      error: 'You are not permitted to send account invitations.',
    });
    expect(issueTenantInvitation).not.toHaveBeenCalled();
  });
});
