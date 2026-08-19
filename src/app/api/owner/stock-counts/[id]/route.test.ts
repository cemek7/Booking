import { describe, expect, it, jest } from '@jest/globals';

const mockGetCountSessionWithItems = jest.fn();
const mockEnterCount = jest.fn();

jest.mock('@/lib/inventory/stockCountService', () => ({
  getCountSessionWithItems: (...args: unknown[]) => mockGetCountSessionWithItems(...args),
  enterCount: (...args: unknown[]) => mockEnterCount(...args),
}));

import { GET, PATCH } from './route';

describe('/api/owner/stock-counts/[id]', () => {
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const itemId = '22222222-2222-4222-8222-222222222222';

  it('returns the stock count session detail', async () => {
    mockGetCountSessionWithItems.mockResolvedValueOnce({ session: { id: sessionId }, items: [] });

    const response = await GET({
      request: new Request(`http://localhost/api/owner/stock-counts/${sessionId}`, { method: 'GET' }),
      supabase: {} as never,
      params: { id: sessionId },
      user: { id: 'user-1', email: 'owner@test.com', role: 'owner', tenantId: 'tenant-1', permissions: [] },
    });

    expect(mockGetCountSessionWithItems).toHaveBeenCalledWith(expect.anything(), 'tenant-1', sessionId);
    expect(response).toEqual({ session: { id: sessionId }, items: [] });
  });

  it('updates a counted quantity for a session item', async () => {
    mockGetCountSessionWithItems.mockResolvedValueOnce({
      session: { id: sessionId },
      items: [{ id: itemId }],
    });
    mockEnterCount.mockResolvedValueOnce({ id: itemId, counted_quantity: 8 });

    const response = await PATCH({
      request: {
        method: 'PATCH',
        url: `http://localhost/api/owner/stock-counts/${sessionId}`,
        headers: { get: () => null },
        json: async () => ({ item_id: itemId, counted_quantity: 8 }),
      } as never,
      supabase: {} as never,
      params: { id: sessionId },
      user: { id: 'user-1', email: 'owner@test.com', role: 'owner', tenantId: 'tenant-1', permissions: [] },
    });

    expect(mockEnterCount).toHaveBeenCalledWith(expect.anything(), itemId, 8);
    expect(response).toEqual({ item: { id: itemId, counted_quantity: 8 } });
  });
});
