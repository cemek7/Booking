import { describe, expect, it, jest } from '@jest/globals';

const mockDecideApproval = jest.fn();

jest.mock('@/lib/approvals/requests', () => ({
  decideApproval: (...args: unknown[]) => mockDecideApproval(...args),
}));

import { PATCH } from './route';

describe('/api/owner/approvals/[id]', () => {
  it('decides an approval request using tenant user identity', async () => {
    mockDecideApproval.mockResolvedValueOnce({ id: 'approval-1', status: 'approved' });

    const response = await PATCH({
      request: {
        method: 'PATCH',
        url: 'http://localhost/api/owner/approvals/approval-1',
        headers: { get: () => null },
        json: async () => ({ decision: 'approve', note: 'Looks fine' }),
      } as never,
      supabase: {} as never,
      params: { id: 'approval-1' },
      user: {
        id: 'user-auth-1',
        tenantUserId: 'tenant-user-1',
        email: 'owner@test.com',
        role: 'owner',
        tenantId: 'tenant-1',
        permissions: ['APPROVE_REFUNDS'],
      },
    });

    expect(mockDecideApproval).toHaveBeenCalledWith(expect.anything(), {
      requestId: 'approval-1',
      actorId: 'tenant-user-1',
      actorPerms: ['APPROVE_REFUNDS'],
      decision: 'approve',
      note: 'Looks fine',
    });
    expect(response).toEqual({ approval: { id: 'approval-1', status: 'approved' } });
  });
});
