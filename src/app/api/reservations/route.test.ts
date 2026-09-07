import { describe, expect, it } from '@jest/globals';
const mockAdminFrom = jest.fn();
jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => ({ from: mockAdminFrom }),
}));

import { GET } from './route';
import type { NextRequest } from 'next/server';

describe('/api/reservations', () => {
  it('returns the documented data and pagination envelope for a global superadmin', async () => {
    const range = jest.fn().mockResolvedValue({ data: [{ id: 'reservation-1', tenant_id: 'tenant-a' }], error: null });
    const order = jest.fn().mockReturnValue({ range });
    const dataSelect = jest.fn().mockReturnValue({ order });
    const countSelect = jest.fn().mockResolvedValue({ count: 1, error: null });
    mockAdminFrom.mockImplementation((table: string) => ({ select: table === 'reservations' && mockAdminFrom.mock.calls.length <= 1 ? dataSelect : countSelect }));

    const result = await GET({
      request: new Request('http://localhost/api/reservations?page=2&limit=10') as unknown as NextRequest,
      supabase: {} as never,
      user: { id: 'admin-1', email: 'admin@example.com', role: 'superadmin', permissions: [] },
    });

    expect(range).toHaveBeenCalledWith(10, 19);
    expect(result).toEqual({ data: [{ id: 'reservation-1', tenant_id: 'tenant-a' }], pagination: { page: 2, limit: 10, total: 1, offset: 10 } });
  });
});
