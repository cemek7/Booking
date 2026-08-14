import { describe, expect, it, jest } from '@jest/globals';
import { isActiveGlobalAdmin, normalizeAdminEmail, resolveActiveGlobalAdmin } from './global-admin';

function adminClient(result: { data: unknown; error: unknown }) {
  const chain = {
    select: jest.fn(),
    ilike: jest.fn(),
    maybeSingle: jest.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.ilike.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue(result);
  return {
    from: jest.fn().mockReturnValue(chain),
    chain,
  };
}

describe('global admin resolution', () => {
  it('normalizes identity emails before performing a case-insensitive lookup', async () => {
    const client = adminClient({ data: { email: 'Admin@Booka.ng', status: true }, error: null });

    await expect(resolveActiveGlobalAdmin(client as never, ' ADMIN@booka.ng ')).resolves.toEqual({
      email: 'Admin@Booka.ng',
      status: true,
    });
    expect(client.from).toHaveBeenCalledWith('admins');
    expect(client.chain.ilike).toHaveBeenCalledWith('email', 'admin@booka.ng');
  });

  it('does not grant access to an explicitly disabled admin', async () => {
    const client = adminClient({ data: { email: 'admin@booka.ng', status: false }, error: null });
    await expect(isActiveGlobalAdmin(client as never, 'admin@booka.ng')).resolves.toBe(false);
  });

  it('keeps nullable legacy status rows working', async () => {
    const client = adminClient({ data: { email: 'admin@booka.ng', status: null }, error: null });
    await expect(isActiveGlobalAdmin(client as never, 'admin@booka.ng')).resolves.toBe(true);
    expect(normalizeAdminEmail(' ADMIN@BOOKA.NG ')).toBe('admin@booka.ng');
  });
});
