import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const responseMap = new Map<string, Array<{ data: unknown; error: { message: string } | null }>>();

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => ({
    from: jest.fn((table: string) => {
      const state = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn(() => Promise.resolve((responseMap.get(`${table}:maybeSingle`) ?? []).shift() ?? { data: null, error: null })),
        then: undefined as unknown,
      } as {
        select: jest.Mock;
        eq: jest.Mock;
        in: jest.Mock;
        not: jest.Mock;
        order: jest.Mock;
        limit: jest.Mock;
        maybeSingle: jest.Mock;
        then?: (onfulfilled: (value: unknown) => unknown) => unknown;
      };

      state.then = (onfulfilled) =>
        Promise.resolve(onfulfilled((responseMap.get(table) ?? []).shift() ?? { data: [], error: null }));

      return state;
    }),
  }),
}));

import { resolveIncoming } from './identityResolver';

describe('resolveIncoming', () => {
  beforeEach(() => {
    responseMap.clear();
  });

  it('returns tenant_user_id and user_id for owner/staff phone matches', async () => {
    responseMap.set('whatsapp_conversations', [{ data: [], error: null }]);
    responseMap.set('tenant_users:maybeSingle', [
      {
        data: {
          id: 'tenant-user-1',
          user_id: 'user-1',
          tenant_id: 'tenant-1',
          role: 'manager',
        },
        error: null,
      },
    ]);

    const identity = await resolveIncoming('whatsapp', '+2348000000000', 'refund that order');

    expect(identity).toEqual(
      expect.objectContaining({
        tenantId: 'tenant-1',
        role: 'staff',
        tenantUserId: 'tenant-user-1',
        userId: 'user-1',
        routingCodeFound: false,
      })
    );
  });

  it('keeps tenant_user_id null when routing by code as a customer', async () => {
    responseMap.set('whatsapp_conversations', [{ data: [], error: null }]);
    responseMap.set('tenant_users:maybeSingle', [{ data: null, error: null }]);
    responseMap.set('tenants:maybeSingle', [{ data: { id: 'tenant-2' }, error: null }]);

    const identity = await resolveIncoming('whatsapp', '+2348000000001', 'BOOK12 I need help');

    expect(identity).toEqual(
      expect.objectContaining({
        tenantId: 'tenant-2',
        role: 'customer',
        tenantUserId: null,
        userId: null,
        routingCodeFound: true,
      })
    );
  });
});
