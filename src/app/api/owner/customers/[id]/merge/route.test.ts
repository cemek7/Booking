import { describe, expect, it, jest } from '@jest/globals';

const mockMergeCustomers = jest.fn();
const mockCreateSupabaseAdminClient = jest.fn();

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => mockCreateSupabaseAdminClient(),
}));

jest.mock('@/lib/customers/merge', () => ({
  mergeCustomers: (...args: unknown[]) => mockMergeCustomers(...args),
}));

import { POST } from './route';

describe('/api/owner/customers/[id]/merge', () => {
  it('merges loser into survivor using owner identity', async () => {
    mockCreateSupabaseAdminClient.mockReturnValue({});
    mockMergeCustomers.mockResolvedValueOnce({ survivorId: 'cust-1', loserId: 'cust-2' });

    const response = await POST({
      request: {
        method: 'POST',
        url: 'http://localhost/api/owner/customers/cust-1/merge',
        headers: { get: () => null },
        json: async () => ({ loser_id: '3f28a9b0-7f6d-4d79-9c95-9fe6fdb5c8e2' }),
      } as never,
      supabase: {} as never,
      params: { id: 'cust-1' },
      user: {
        id: 'user-1',
        email: 'owner@test.com',
        role: 'owner',
        tenantId: 'tenant-1',
        permissions: ['MERGE_CUSTOMERS'],
      },
    });

    expect(mockMergeCustomers).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      survivorId: 'cust-1',
      loserId: '3f28a9b0-7f6d-4d79-9c95-9fe6fdb5c8e2',
      actorId: 'user-1',
    });
    expect(response).toEqual({ merged: { survivorId: 'cust-1', loserId: 'cust-2' } });
  });
});
