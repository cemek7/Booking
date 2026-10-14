// Jest globals are available without import
import { NextRequest } from 'next/server';
const issueTenantInvitation = jest.fn();
jest.mock('@/lib/auth/issue-tenant-invitation', () => {
  const actual = jest.requireActual('@/lib/auth/issue-tenant-invitation');
  return {
    ...actual,
    issueTenantInvitation: (...args: unknown[]) => issueTenantInvitation(...args),
  };
});
import { POST as invitesPOST } from '@/app/api/tenants/[tenantId]/invites/route';
import { InvitationIssueError } from '@/lib/auth/issue-tenant-invitation';

// Configurable stubs — read by the bearer client mock factory via closure
let callerRole = 'manager';
let currentSettings = { allowedInviterRoles: ['manager'], allowInvitesFromStaffPage: true };
type InviteRow = { token: string; tenant_id: string; email: string; role: string };
const inserted: InviteRow[] = [];

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(() => ({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'u1', email: 'u1@example.com' } },
        error: null,
      }),
    },
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'tenant_users') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { tenant_id: 't1', role: callerRole },
            error: null,
          }),
        };
      }
      if (table === 'tenants') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { lifecycle_state: 'active' },
            error: null,
          }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  })),
}));

jest.mock('@/lib/supabase/bearer-client', () => ({
  createSupabaseBearerClient: jest.fn().mockImplementation(() => ({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'u1', email: 'u1@example.com' } },
        error: null,
      }),
    },
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'tenant_users') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockImplementation(() =>
            Promise.resolve({ data: { role: callerRole }, error: null })
          ),
          maybeSingle: jest.fn().mockImplementation(() =>
            Promise.resolve({ data: { tenant_id: 't1', role: callerRole }, error: null })
          ),
          then: (resolve: (value: unknown) => void) =>
            resolve({ data: [{ tenant_id: 't1', role: callerRole }], error: null }),
        };
      }
      if (table === 'tenants') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockImplementation(() =>
            Promise.resolve({ data: { settings: currentSettings }, error: null })
          ),
        };
      }
      if (table === 'invites') {
        return {
          insert: jest.fn().mockImplementation((row: InviteRow) => {
            inserted.push(row);
            return Promise.resolve({ error: null });
          }),
        };
      }
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis() };
    }),
  })),
}));

describe('Invites API', () => {
  beforeEach(() => {
    currentSettings = { allowedInviterRoles: ['manager'], allowInvitesFromStaffPage: true };
    callerRole = 'manager';
    inserted.length = 0;
    issueTenantInvitation.mockReset().mockResolvedValue({
      ok: true,
      email_sent: true,
      expires_at: '2026-10-21T12:00:00.000Z',
    });
  });

  it('requires Authorization bearer token', async () => {
    const req = new NextRequest('https://staging.app.techclave.cloud/api/tenants/t1/invites', {
      method: 'POST',
      headers: { 'x-test-bypass-skip': '1' },
      body: JSON.stringify({ email: 'a@b.com' })
    });
    const res: Response = await invitesPOST(req, { params: { tenantId: 't1' } });
    expect(res.status).toBe(401);
  });

  it('creates invite when allowed', async () => {
    const req = new NextRequest('https://staging.app.techclave.cloud/api/tenants/t1/invites', {
      method: 'POST',
      headers: { 'authorization': 'Bearer test-token', 'x-tenant-id': 't1' },
      body: JSON.stringify({ email: 'user@example.com', role: 'staff' })
    });
    const res: Response = await invitesPOST(req, { params: { tenantId: 't1' } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('ok', true);
    expect(json).not.toHaveProperty('url');
    expect(json).not.toHaveProperty('token');
    expect(issueTenantInvitation).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1',
      invitedEmail: 'user@example.com',
      invitedRole: 'staff',
    }));
  });

  it('returns 403 when settings disallow', async () => {
    currentSettings = { allowedInviterRoles: ['owner'], allowInvitesFromStaffPage: false };
    issueTenantInvitation.mockRejectedValue(new InvitationIssueError('invite_disabled', 403));
    const req = new NextRequest('https://staging.app.techclave.cloud/api/tenants/t1/invites', {
      method: 'POST',
      headers: { 'authorization': 'Bearer test-token', 'x-tenant-id': 't1' },
      body: JSON.stringify({ email: 'user@example.com', role: 'staff' })
    });
    const res: Response = await invitesPOST(req, { params: { tenantId: 't1' } });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json).toHaveProperty('error');
  });
});
