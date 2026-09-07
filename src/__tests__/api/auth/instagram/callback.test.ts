import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const verifyStateMock = jest.fn();
const exchangeCodeMock = jest.fn();
const exchangeLongMock = jest.fn();
const upsertSecretMock = jest.fn();
const createAdminMock = jest.fn();

jest.mock('@/lib/instagram/oauthState', () => ({
  verifyState: (...args: unknown[]) => verifyStateMock(...args),
}));
jest.mock('@/lib/instagram/oauthClient', () => ({
  getInstagramOAuthConfig: () => ({ appId: 'ig-app', appSecret: 'secret', redirectUri: 'https://app.example/callback' }),
  exchangeCodeForToken: (...args: unknown[]) => exchangeCodeMock(...args),
  exchangeForLongLivedToken: (...args: unknown[]) => exchangeLongMock(...args),
}));
jest.mock('@/lib/instagram/secrets', () => ({
  upsertInstagramSecret: (...args: unknown[]) => upsertSecretMock(...args),
}));
jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => createAdminMock(),
}));

import { GET } from '@/app/api/auth/instagram/callback/route';

function tenantAdmin(role: string | null = 'owner', lifecycleState = 'active') {
  let table = '';
  const builder: Record<string, unknown> = {
    from: (nextTable: string) => {
      table = nextTable;
      return builder;
    },
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve(table === 'tenant_users'
      ? { data: role ? { tenant_id: 'tenant-123', role } : null, error: null }
      : { data: { lifecycle_state: lifecycleState }, error: null }),
  };
  return builder;
}

describe('GET /api/auth/instagram/callback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.APP_URL = 'https://booka.app.techclave.cloud';
    verifyStateMock.mockReturnValue('tenant-123');
    exchangeCodeMock.mockResolvedValue({ accessToken: 'short-token', userId: 'ig-user' });
    exchangeLongMock.mockResolvedValue({ accessToken: 'long-token', expiresIn: 3600 });
    upsertSecretMock.mockResolvedValue(undefined);
    createAdminMock.mockImplementation(() => tenantAdmin());
  });

  it('uses signed state to authorize the owner when Meta returns without a tenant header', async () => {
    const response = await GET({
      request: {
        url: 'https://booka.app.techclave.cloud/api/auth/instagram/callback?code=oauth-code&state=signed-state',
        method: 'GET',
        headers: { get: () => null },
      },
      user: { id: 'user-123', email: 'owner@example.com' },
      supabase: {},
    } as never);

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(await response.json()).toEqual({
      url: 'https://booka.app.techclave.cloud/dashboard/settings?tab=whatsapp&instagram=connected',
    });
    expect(upsertSecretMock).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-123',
      expect.objectContaining({ accessToken: 'long-token', igId: 'ig-user' }),
    );
  });

  it('rejects a non-owner before exchanging or storing Meta tokens', async () => {
    createAdminMock.mockImplementation(() => tenantAdmin('staff'));

    await expect(GET({
      request: {
        url: 'https://booka.app.techclave.cloud/api/auth/instagram/callback?code=oauth-code&state=signed-state',
        method: 'GET',
        headers: { get: () => null },
      },
      user: { id: 'user-456', email: 'staff@example.com' },
      supabase: {},
    } as never)).rejects.toMatchObject({ statusCode: 403 });

    expect(exchangeCodeMock).not.toHaveBeenCalled();
    expect(exchangeLongMock).not.toHaveBeenCalled();
    expect(upsertSecretMock).not.toHaveBeenCalled();
  });

  it('rejects a locked tenant before exchanging or storing Meta tokens', async () => {
    createAdminMock.mockImplementation(() => tenantAdmin('owner', 'offboarding'));

    await expect(GET({
      request: {
        url: 'https://booka.app.techclave.cloud/api/auth/instagram/callback?code=oauth-code&state=signed-state',
        method: 'GET',
        headers: { get: () => null },
      },
      user: { id: 'user-123', email: 'owner@example.com' },
      supabase: {},
    } as never)).rejects.toMatchObject({ statusCode: 423 });

    expect(exchangeCodeMock).not.toHaveBeenCalled();
    expect(exchangeLongMock).not.toHaveBeenCalled();
    expect(upsertSecretMock).not.toHaveBeenCalled();
  });
});
