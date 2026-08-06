import { describe, expect, it, jest } from '@jest/globals';

const mockListRecommendations = jest.fn();

jest.mock('@/lib/recommendations/outcomes', () => ({
  listRecommendations: (...args: unknown[]) => mockListRecommendations(...args),
}));

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => ({ mocked: true }),
}));

import { GET } from './route';

describe('GET /api/owner/recommendations', () => {
  it('lists tenant recommendations with status filters', async () => {
    mockListRecommendations.mockResolvedValueOnce([{ id: 'rec-1', type: 'likely_stockout' }]);

    const response = await GET({
      request: {
        method: 'GET',
        url: 'http://localhost/api/owner/recommendations?status=pending&type=likely_stockout',
        headers: { get: () => null },
      } as never,
      supabase: {} as never,
      user: {
        id: 'user-1',
        email: 'owner@test.com',
        role: 'owner',
        tenantId: 'tenant-1',
        permissions: ['VIEW_ANALYTICS'],
      },
    });

    expect(mockListRecommendations).toHaveBeenCalledWith(
      { mocked: true },
      'tenant-1',
      expect.objectContaining({
        status: 'pending',
        type: 'likely_stockout',
      }),
    );
    expect(response).toEqual({ recommendations: [{ id: 'rec-1', type: 'likely_stockout' }] });
  });
});
