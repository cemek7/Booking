import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCreateSupabaseAdminClient = jest.fn();
const mockRecomputeProfile = jest.fn();
const mockDetectDuplicates = jest.fn();

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => mockCreateSupabaseAdminClient(),
}));

jest.mock('@/lib/customers/profile', () => ({
  recomputeProfile: (...args: unknown[]) => mockRecomputeProfile(...args),
}));

jest.mock('@/lib/customers/merge', () => ({
  detectDuplicates: (...args: unknown[]) => mockDetectDuplicates(...args),
}));

import { GET } from './route';

function createAdminMock() {
  return {
    from: jest.fn((table: string) => {
      if (table === 'customers') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'cust-1',
                    name: 'Ada',
                    customer_name: 'Ada',
                    email: 'ada@test.com',
                    phone: '+2348031234567',
                    phone_number: '+2348031234567',
                    normalized_phone: '+2348031234567',
                    tags: ['vip'],
                    notes: 'Private note',
                    merged_into: null,
                    created_at: '2026-07-20T00:00:00.000Z',
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'customer_profile_summary') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { lifetime_value_cents: 39000, outstanding_balance_cents: 4000 },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'reservations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => ({ data: [{ id: 'r1', status: 'completed' }], error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'retail_orders') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => ({ data: [{ id: 'o1', payment_status: 'paid' }], error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'customer_merge_candidates') {
        return {
          select: () => ({
            eq: () => ({
              or: () => ({
                order: async () => ({ data: [{ id: 'cand-1', customer_a: 'cust-1', customer_b: 'cust-2', score: 1, status: 'pending' }], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'messaging_consents') {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: [{ recipient: '+2348031234567', channel: 'whatsapp' }], error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

describe('/api/owner/customers/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateSupabaseAdminClient.mockReturnValue(createAdminMock());
    mockRecomputeProfile.mockResolvedValue(undefined);
    mockDetectDuplicates.mockResolvedValue([]);
  });

  it('returns owner customer profile and includes notes when permitted', async () => {
    const response = await GET({
      request: new Request('http://localhost/api/owner/customers/cust-1', { method: 'GET' }),
      supabase: {} as never,
      params: { id: 'cust-1' },
      user: {
        id: 'user-1',
        email: 'owner@test.com',
        role: 'owner',
        tenantId: 'tenant-1',
        permissions: ['VIEW_ANALYTICS', 'VIEW_CUSTOMER_NOTES', 'MERGE_CUSTOMERS'],
      },
    });

    expect(response).toMatchObject({
      customer: {
        id: 'cust-1',
        notes: 'Private note',
      },
      summary: {
        lifetime_value_cents: 39000,
      },
      permissions: {
        canViewNotes: true,
        canMergeCustomers: true,
      },
    });
  });
});
