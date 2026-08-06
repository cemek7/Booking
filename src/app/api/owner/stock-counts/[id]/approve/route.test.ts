import { describe, expect, it, jest } from '@jest/globals';

const mockApproveSession = jest.fn();

jest.mock('@/lib/inventory/stockCountService', () => ({
  approveSession: (...args: unknown[]) => mockApproveSession(...args),
}));

import { POST } from './route';

describe('/api/owner/stock-counts/[id]/approve', () => {
  it('approves a stock count session', async () => {
    mockApproveSession.mockResolvedValueOnce({ id: 'session-1', status: 'approved' });

    const response = await POST({
      request: new Request('http://localhost/api/owner/stock-counts/session-1/approve', { method: 'POST' }),
      supabase: {} as never,
      params: { id: 'session-1' },
      user: { id: 'user-1', email: 'owner@test.com', role: 'owner', tenantId: 'tenant-1', permissions: [] },
    });

    expect(mockApproveSession).toHaveBeenCalledWith(expect.anything(), 'session-1', 'user-1', 'tenant-1');
    expect(response).toEqual({ session: { id: 'session-1', status: 'approved' } });
  });
});
