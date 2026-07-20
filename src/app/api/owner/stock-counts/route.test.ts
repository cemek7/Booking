import { describe, expect, it, jest } from '@jest/globals';

const mockListCountSessions = jest.fn();
const mockStartCountSession = jest.fn();

jest.mock('@/lib/inventory/stockCountService', () => ({
  listCountSessions: (...args: unknown[]) => mockListCountSessions(...args),
  startCountSession: (...args: unknown[]) => mockStartCountSession(...args),
}));

import { GET, POST } from './route';

describe('/api/owner/stock-counts', () => {
  it('lists stock count sessions', async () => {
    mockListCountSessions.mockResolvedValueOnce([{ id: 'session-1' }]);

    const response = await GET({
      request: new Request('http://localhost/api/owner/stock-counts', { method: 'GET' }),
      supabase: {} as never,
      user: { id: 'user-1', email: 'owner@test.com', role: 'owner', tenantId: 'tenant-1', permissions: [] },
    });

    expect(mockListCountSessions).toHaveBeenCalledWith(expect.anything(), 'tenant-1');
    expect(response).toEqual({ sessions: [{ id: 'session-1' }] });
  });

  it('creates a stock count session', async () => {
    mockStartCountSession.mockResolvedValueOnce({ id: 'session-1', status: 'counting' });

    const response = await POST({
      request: {
        method: 'POST',
        url: 'http://localhost/api/owner/stock-counts',
        headers: { get: () => null },
        json: async () => ({ location_id: null }),
      } as never,
      supabase: {} as never,
      user: { id: 'user-1', email: 'owner@test.com', role: 'owner', tenantId: 'tenant-1', permissions: [] },
    });

    expect(mockStartCountSession).toHaveBeenCalledWith(expect.anything(), 'tenant-1', null, 'user-1');
    expect(response).toEqual({ session: { id: 'session-1', status: 'counting' } });
  });
});
