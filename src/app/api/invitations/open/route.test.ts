import type { NextRequest } from 'next/server';
import { hashInvitationToken } from '@/lib/auth/tenant-invitations';

const maybeSingle = jest.fn();
const eq = jest.fn(() => ({ maybeSingle }));
const select = jest.fn(() => ({ eq }));

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => ({ from: () => ({ select }) }),
}));

import { GET } from './route';

function request(url: string): NextRequest {
  return {
    url,
    nextUrl: new URL(url),
    headers: new Headers(),
  } as unknown as NextRequest;
}

describe('GET /api/invitations/open', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    maybeSingle.mockResolvedValue({
      data: {
        expires_at: '2099-10-21T12:00:00.000Z',
        accepted_at: null,
        revoked_at: null,
      },
      error: null,
    });
  });

  it('moves a valid raw token into a hardened cookie', async () => {
    const rawToken = 'a'.repeat(43);
    const tokenHash = hashInvitationToken(rawToken);
    const response = await GET(request(
      `https://staging.app.techclave.cloud/api/invitations/open?token=${rawToken}`
    ));

    expect(eq).toHaveBeenCalledWith('token_hash', tokenHash);
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get('location')).toBe('https://staging.app.techclave.cloud/accept-invite');
    expect(response.headers.get('location')).not.toContain(rawToken);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toContain(`booka_tenant_invitation=${rawToken}`);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');
  });

  it.each([
    ['missing', '', undefined],
    ['malformed', '?token=bad', undefined],
    ['unknown', null, null],
    ['expired', null, { expires_at: '2020-01-01T00:00:00.000Z', accepted_at: null, revoked_at: null }],
    ['accepted', null, { expires_at: '2099-01-01T00:00:00.000Z', accepted_at: '2026-01-01', revoked_at: null }],
    ['revoked', null, { expires_at: '2099-01-01T00:00:00.000Z', accepted_at: null, revoked_at: '2026-01-01' }],
  ])('uses the same generic redirect for %s tokens', async (_label, query, row) => {
    const rawToken = 'a'.repeat(43);
    if (row !== undefined) maybeSingle.mockResolvedValue({ data: row, error: null });
    const suffix = query === null ? `?token=${rawToken}` : query;
    const response = await GET(request(
      `https://staging.app.techclave.cloud/api/invitations/open${suffix}`
    ));

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get('location')).toBe('https://staging.app.techclave.cloud/invitation-invalid');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
