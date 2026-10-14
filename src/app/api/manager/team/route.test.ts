import { NextRequest } from 'next/server';

const issueTenantInvitation = jest.fn();
jest.mock('@/lib/auth/issue-tenant-invitation', () => ({
  issueTenantInvitation: (...args: unknown[]) => issueTenantInvitation(...args),
}));

import { POST } from './route';

describe('manager team invitation action', () => {
  beforeEach(() => {
    issueTenantInvitation.mockReset().mockResolvedValue({
      ok: true,
      email_sent: true,
      expires_at: '2026-10-21T12:00:00.000Z',
    });
  });

  it('allows a manager to issue only a staff invitation', async () => {
    const result = await POST({
      request: new NextRequest('https://staging.app.techclave.cloud/api/manager/team', {
        method: 'POST',
        body: JSON.stringify({
          action: 'invite-member',
          data: { email: 'Staff@Example.com', role: 'staff' },
        }),
      }),
      user: {
        id: 'manager-user',
        email: 'manager@example.com',
        role: 'manager',
        tenantId: 'tenant-1',
      },
      supabase: {} as never,
    });

    expect(issueTenantInvitation).toHaveBeenCalledWith(expect.objectContaining({
      actorRole: 'manager',
      invitedEmail: 'staff@example.com',
      invitedRole: 'staff',
      source: 'manager_api',
    }));
    expect(result).not.toHaveProperty('url');
  });

  it('rejects manager-role invitations before issuance', async () => {
    await expect(
      POST({
        request: new NextRequest('https://app.techclave.cloud/api/manager/team', {
          method: 'POST',
          body: JSON.stringify({
            action: 'invite-member',
            data: { email: 'manager@example.com', role: 'manager' },
          }),
        }),
        user: {
          id: 'manager-user',
          email: 'manager@example.com',
          role: 'manager',
          tenantId: 'tenant-1',
        },
        supabase: {} as never,
      })
    ).rejects.toThrow();
    expect(issueTenantInvitation).not.toHaveBeenCalled();
  });
});
