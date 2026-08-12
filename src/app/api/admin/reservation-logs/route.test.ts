import { describe, expect, it, jest } from '@jest/globals';

const mockAdminFrom = jest.fn();
jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => ({ from: mockAdminFrom }),
}));

import { GET } from './route';

describe('/api/admin/reservation-logs', () => {
  it('lets a global superadmin browse logs without inventing a tenant context', async () => {
    const limit = jest.fn().mockResolvedValue({ data: [{ id: 'log-1', tenant_id: 'tenant-a' }], error: null });
    const order = jest.fn().mockReturnValue({ limit });
    const select = jest.fn().mockReturnValue({ order });
    mockAdminFrom.mockReturnValue({ select });

    const result = await GET({
      request: new Request('http://localhost/api/admin/reservation-logs'),
      supabase: {} as never,
      user: { id: 'admin-1', email: 'admin@example.com', role: 'superadmin', permissions: [] },
    });

    expect(mockAdminFrom).toHaveBeenCalledWith('reservation_logs');
    expect(result).toEqual({ data: [{ id: 'log-1', tenant_id: 'tenant-a' }] });
  });
});
