import { NextRequest } from 'next/server';

const issueTenantInvitation = jest.fn();
jest.mock('@/lib/auth/issue-tenant-invitation', () => ({
  issueTenantInvitation: (...args: unknown[]) => issueTenantInvitation(...args),
}));

import { POST } from './route';

describe('owner staff invitation action', () => {
  beforeEach(() => {
    issueTenantInvitation.mockReset().mockResolvedValue({
      ok: true,
      email_sent: true,
      expires_at: '2026-10-21T12:00:00.000Z',
    });
  });

  it('routes owner invitations through the secure issuer', async () => {
    const result = await POST({
      request: new NextRequest('https://staging.app.techclave.cloud/api/owner/staff', {
        method: 'POST',
        body: JSON.stringify({
          action: 'invite',
          data: { email: 'Manager@Example.com', role: 'manager' },
        }),
      }),
      user: {
        id: 'owner-user',
        email: 'owner@example.com',
        role: 'owner',
        tenantId: 'tenant-1',
      },
      supabase: {} as never,
    });

    expect(issueTenantInvitation).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      actorUserId: 'owner-user',
      actorRole: 'owner',
      invitedEmail: 'manager@example.com',
      invitedRole: 'manager',
      source: 'owner_api',
    }));
    expect(result).not.toHaveProperty('url');
    expect(result).not.toHaveProperty('token');
  });
});
