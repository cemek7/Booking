import type { NextRequest } from 'next/server';
import { hashInvitationToken } from '@/lib/auth/tenant-invitations';

const maybeSingle = jest.fn();
const eq = jest.fn(() => ({ maybeSingle }));
const select = jest.fn(() => ({ eq }));
const getUser = jest.fn();

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => ({ from: () => ({ select }) }),
  getSupabaseRouteHandlerClient: () => ({ auth: { getUser } }),
}));

import { GET } from './route';

const rawToken = 'a'.repeat(43);
const validInvitation = {
  email: 'invited@example.com',
  role: 'staff',
  expires_at: '2099-10-21T12:00:00.000Z',
  accepted_at: null,
  revoked_at: null,
  tenant_id: 'tenant-1',
  tenants: { id: 'tenant-1', name: 'Northstar Clinic' },
};

function request(token = rawToken): NextRequest {
  const url = 'https://staging.app.techclave.cloud/api/invitations/status';
  return {
    url,
    nextUrl: new URL(url),
    headers: new Headers({ cookie: `booka_tenant_invitation=${token}` }),
  } as unknown as NextRequest;
}

describe('GET /api/invitations/status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    maybeSingle.mockResolvedValue({ data: validInvitation, error: null });
    getUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  it('returns safe, masked status for a signed-out visitor', async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(eq).toHaveBeenCalledWith('token_hash', hashInvitationToken(rawToken));
    expect(body).toEqual({
      valid: true,
      tenant: { id: 'tenant-1', name: 'Northstar Clinic' },
      role: 'staff',
      masked_email: 'i***@example.com',
      expires_at: '2099-10-21T12:00:00.000Z',
      authenticated: false,
      email_matches: null,
    });
    expect(JSON.stringify(body)).not.toContain('invited@example.com');
    expect(JSON.stringify(body)).not.toContain(rawToken);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('reports whether the verified signed-in email matches', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'INVITED@example.com' } },
      error: null,
    });

    await expect((await GET(request())).json()).resolves.toMatchObject({
      authenticated: true,
      email_matches: true,
    });
  });

  it.each([
    ['missing cookie', request('bad')],
    ['unknown', request()],
    ['expired', request()],
    ['accepted', request()],
    ['revoked', request()],
  ])('returns one generic shape for %s', async (state, req) => {
    if (state === 'unknown') maybeSingle.mockResolvedValue({ data: null, error: null });
    if (state === 'expired') maybeSingle.mockResolvedValue({
      data: { ...validInvitation, expires_at: '2020-01-01T00:00:00.000Z' }, error: null,
    });
    if (state === 'accepted') maybeSingle.mockResolvedValue({
      data: { ...validInvitation, accepted_at: '2026-01-01T00:00:00.000Z' }, error: null,
    });
    if (state === 'revoked') maybeSingle.mockResolvedValue({
      data: { ...validInvitation, revoked_at: '2026-01-01T00:00:00.000Z' }, error: null,
    });

    const response = await GET(req);
    await expect(response.json()).resolves.toEqual({ valid: false });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
