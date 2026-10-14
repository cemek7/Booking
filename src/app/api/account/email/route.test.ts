import type { NextRequest } from 'next/server';

const checkRateLimit = jest.fn();

jest.mock('@/lib/error-handling/migration-helpers', () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
}));

import { POST } from './route';

function context(email = 'New@Example.com') {
  const updateUser = jest.fn().mockResolvedValue({ data: {}, error: null });
  return {
    updateUser,
    routeContext: {
      request: {
        url: 'https://staging.app.techclave.cloud/api/account/email',
        method: 'POST',
        headers: new Headers(),
        json: async () => ({ email }),
      } as unknown as NextRequest,
      user: { id: 'user-1', email: 'old@example.com', role: 'staff', permissions: [] },
      supabase: { auth: { updateUser } } as never,
    },
  };
}

describe('POST /api/account/email', () => {
  beforeEach(() => checkRateLimit.mockReset().mockReturnValue({ allowed: true }));

  it('uses user-scoped Supabase auth with the staging callback', async () => {
    const { routeContext, updateUser } = context();
    await expect(POST(routeContext)).resolves.toEqual({
      ok: true,
      status: 'confirmation_sent',
    });
    expect(updateUser).toHaveBeenCalledWith(
      { email: 'new@example.com' },
      {
        emailRedirectTo:
          'https://staging.app.techclave.cloud/booka/auth/callback?finalize=1&next=%2Fdashboard%2Fsettings%3Ftab%3Dsecurity',
      }
    );
  });

  it('rejects unchanged and invalid emails', async () => {
    await expect(POST(context('OLD@example.com').routeContext)).rejects.toMatchObject({ statusCode: 400 });
    await expect(POST(context('not-email').routeContext)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rate-limits repeated requests by immutable user ID', async () => {
    checkRateLimit.mockReturnValue({ allowed: false });
    const { routeContext, updateUser } = context();
    await expect(POST(routeContext)).rejects.toMatchObject({ statusCode: 429 });
    expect(checkRateLimit).toHaveBeenCalledWith('account-email:user-1', 3, 60 * 60 * 1000);
    expect(updateUser).not.toHaveBeenCalled();
  });
});
