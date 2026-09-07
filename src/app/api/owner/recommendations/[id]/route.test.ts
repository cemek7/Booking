import { describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

const mockDecideRecommendation = jest.fn();

jest.mock('@/lib/recommendations/outcomes', () => ({
  decideRecommendation: (...args: unknown[]) => mockDecideRecommendation(...args),
}));

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => ({ mocked: true }),
}));

import { PATCH } from './route';

describe('PATCH /api/owner/recommendations/[id]', () => {
  it('accepts a recommendation with owner identity and permissions', async () => {
    mockDecideRecommendation.mockResolvedValueOnce({
      recommendation: { id: 'rec-1', status: 'accepted' },
      execution: { executed: true, manualOnly: false, actionId: 'record_purchase' },
    });

    const response = await PATCH({
      request: new NextRequest('http://localhost/api/owner/recommendations/rec-1', {
        method: 'PATCH',
        body: JSON.stringify({ decision: 'accept', note: 'Do it' }),
      }),
      supabase: {} as never,
      params: { id: 'rec-1' },
      user: {
        id: 'user-1',
        email: 'owner@test.com',
        role: 'owner',
        tenantId: 'tenant-1',
        permissions: ['VIEW_ANALYTICS', 'RECORD_PURCHASES'],
      },
    });

    expect(mockDecideRecommendation).toHaveBeenCalledWith(
      { mocked: true },
      expect.objectContaining({
        tenantId: 'tenant-1',
        recommendationId: 'rec-1',
        decision: 'accept',
        actorId: 'user-1',
      }),
    );
    expect(response).toEqual({
      recommendation: { id: 'rec-1', status: 'accepted' },
      execution: { executed: true, manualOnly: false, actionId: 'record_purchase' },
    });
  });

  it('rejects snooze requests without a timestamp', async () => {
    await expect(
      PATCH({
        request: new NextRequest('http://localhost/api/owner/recommendations/rec-1', {
          method: 'PATCH',
          body: JSON.stringify({ decision: 'snooze' }),
        }),
        supabase: {} as never,
        params: { id: 'rec-1' },
        user: {
          id: 'user-1',
          email: 'owner@test.com',
          role: 'owner',
          tenantId: 'tenant-1',
          permissions: ['VIEW_ANALYTICS'],
        },
      })
    ).rejects.toMatchObject({
      code: 'validation_error',
    });
  });
});
