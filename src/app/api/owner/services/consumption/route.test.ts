import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCreateSupabaseAdminClient = jest.fn();

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => mockCreateSupabaseAdminClient(),
}));

import { GET } from './route';

function createAdminMock() {
  return {
    from: jest.fn((table: string) => {
      if (table === 'service_consumption_records') {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                lte: async () => ({
                  data: [
                    {
                      id: 'rec-1',
                      service_id: 'svc-1',
                      staff_id: 'staff-1',
                      product_id: 'product-1',
                      planned_quantity: 6,
                      actual_quantity: 6,
                      uom: 'piece',
                      created_at: '2026-07-20T10:00:00.000Z',
                    },
                    {
                      id: 'rec-2',
                      service_id: 'svc-1',
                      staff_id: 'staff-1',
                      product_id: 'product-2',
                      planned_quantity: 4,
                      actual_quantity: 5,
                      uom: 'piece',
                      created_at: '2026-07-20T11:00:00.000Z',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

describe('/api/owner/services/consumption', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns grouped service consumption totals', async () => {
    mockCreateSupabaseAdminClient.mockReturnValue(createAdminMock());

    const response = await GET({
      request: new Request('http://localhost/api/owner/services/consumption?start=2026-07-20T00:00:00.000Z&end=2026-07-20T23:59:59.999Z', { method: 'GET' }),
      supabase: {} as never,
      user: { id: 'user-1', email: 'owner@test.com', role: 'owner', tenantId: 'tenant-1', permissions: ['MANAGE_PRODUCTS'] },
    });

    expect(response).toEqual({
      totals: [
        {
          service_id: 'svc-1',
          staff_id: 'staff-1',
          planned_quantity: 10,
          actual_quantity: 11,
          variance_quantity: 1,
          records_count: 2,
        },
      ],
    });
  });
});
