// Jest globals are available without import
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useBookingActions } from '@/hooks/useBookingActions';

// @ts-ignore
global.fetch = jest.fn();
const fetchMock = global.fetch as unknown as ReturnType<typeof jest.fn>;

function wrapperFactory() {
  const qc = new QueryClient();
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return Wrapper;
}

describe('useBookingActions', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('posts action to booking actions endpoint', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, booking: { id: 'b1' } }) });
    const { result } = renderHook(() => useBookingActions('b1', 'loc1'), { wrapper: wrapperFactory() });

    await act(async () => {
      const res = await result.current.mutateAsync({ action: 'confirm' });
      expect(res).toHaveProperty('success', true);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/bookings/b1/actions');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toHaveProperty('Content-Type', 'application/json');
    expect(init?.body).toContain('confirm');
  });

  it('throws on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    const { result } = renderHook(() => useBookingActions('b2'), { wrapper: wrapperFactory() });

    await expect(result.current.mutateAsync({ action: 'cancel' } as any)).rejects.toBeTruthy();
  });
});
