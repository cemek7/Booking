import { NextRequest } from 'next/server';

const issueTenantInvitation = jest.fn();

jest.mock('@/lib/auth/issue-tenant-invitation', () => ({
  issueTenantInvitation: (...args: unknown[]) => issueTenantInvitation(...args),
}));

import { POST } from './route';

describe('tenant invitation route', () => {
  beforeEach(() => {
    issueTenantInvitation.mockReset().mockResolvedValue({
      ok: true,
      email_sent: true,
      expires_at: '2026-10-21T12:00:00.000Z',
    });
  });

  it('delegates normalized, role-scoped invitation issuance', async () => {
    const request = new NextRequest(
      'https://staging.app.techclave.cloud/api/tenants/tenant-1/invites',
      {
        method: 'POST',
        body: JSON.stringify({ email: ' STAFF@EXAMPLE.COM ', role: 'staff' }),
      }
    );

    const result = await POST({
      request,
      params: { tenantId: 'tenant-1' },
      user: {
        id: 'user-1',
        email: 'owner@example.com',
        role: 'owner',
        tenantId: 'tenant-1',
      },
      supabase: {} as never,
    });

    expect(issueTenantInvitation).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      actorUserId: 'user-1',
      actorRole: 'owner',
      actorEmail: 'owner@example.com',
      invitedEmail: 'staff@example.com',
      invitedRole: 'staff',
      publicOrigin: 'https://staging.app.techclave.cloud',
      source: 'dashboard',
    });
    expect(result).toEqual({
      ok: true,
      email_sent: true,
      expires_at: '2026-10-21T12:00:00.000Z',
    });
    expect(result).not.toHaveProperty('token');
    expect(result).not.toHaveProperty('url');
  });

  it('rejects arbitrary roles before issuance', async () => {
    const request = new NextRequest('https://app.techclave.cloud/api/tenants/tenant-1/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'staff@example.com', role: 'owner' }),
    });

    await expect(
      POST({
        request,
        params: { tenantId: 'tenant-1' },
        user: {
          id: 'user-1',
          email: 'owner@example.com',
          role: 'owner',
          tenantId: 'tenant-1',
        },
        supabase: {} as never,
      })
    ).rejects.toThrow();
    expect(issueTenantInvitation).not.toHaveBeenCalled();
  });
});
