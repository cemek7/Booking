import { NextRequest, NextResponse } from 'next/server';
import { ApiError } from '@/lib/error-handling/api-error';
import { hashInvitationToken } from '@/lib/auth/tenant-invitations';

const rpc = jest.fn();

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => ({ rpc }),
}));

import { POST } from './route';

const rawToken = 'a'.repeat(43);

function request(withCookie = true): NextRequest {
  const headers = new Headers();
  if (withCookie) headers.set('cookie', `booka_tenant_invitation=${rawToken}`);
  return {
    url: 'https://staging.app.techclave.cloud/api/invitations/accept',
    method: 'POST',
    headers,
  } as unknown as NextRequest;
}

function context(email = 'invited@example.com') {
  return {
    request: request(),
    user: {
      id: 'auth-user-1',
      email,
      role: '',
      permissions: [],
    },
    supabase: {} as never,
  };
}

describe('POST /api/invitations/accept', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rpc.mockResolvedValue({
      data: [{ tenant_id: 'tenant-1', role: 'staff', invitation_id: 'invite-1' }],
      error: null,
    });
  });

  it('requires authentication', async () => {
    const response = await POST(new NextRequest(
      'https://staging.app.techclave.cloud/api/invitations/accept',
      { method: 'POST', headers: { 'x-test-bypass-skip': '1' } }
    )) as NextResponse;

    expect(response.status).toBe(401);
  });

  it('rejects a missing invitation cookie safely', async () => {
    await expect(POST({ ...context(), request: request(false) })).rejects.toMatchObject({
      code: 'invite_invalid',
      statusCode: 400,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('accepts using only the hash and verified identity', async () => {
    const response = await POST(context()) as NextResponse;
    const body = await response.json();

    expect(rpc).toHaveBeenCalledWith('accept_tenant_invitation', {
      p_token_hash: hashInvitationToken(rawToken),
      p_user_id: 'auth-user-1',
      p_user_email: 'invited@example.com',
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(rawToken);
    expect(body).toEqual({
      ok: true,
      tenant_id: 'tenant-1',
      role: 'staff',
      redirect_to: '/dashboard/staff-dashboard',
    });
    expect(response.headers.get('set-cookie')).toContain('booka_tenant_invitation=');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('routes managers to the manager dashboard', async () => {
    rpc.mockResolvedValue({
      data: [{ tenant_id: 'tenant-1', role: 'manager', invitation_id: 'invite-1' }],
      error: null,
    });

    await expect(((await POST(context())) as NextResponse).json()).resolves.toMatchObject({
      role: 'manager',
      redirect_to: '/dashboard',
    });
  });

  it.each([
    'invite_email_mismatch',
    'invite_expired',
    'invite_consumed',
    'invite_membership_conflict',
  ])('maps the stable %s database error', async (code) => {
    rpc.mockResolvedValue({ data: null, error: { message: code } });
    await expect(POST(context())).rejects.toMatchObject({ code });
  });

  it('hides unknown database errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'sensitive database detail' } });
    try {
      await POST(context());
      throw new Error('Expected acceptance failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'invite_invalid' });
      expect(String(error)).not.toContain('sensitive database detail');
    }
  });
});
