// Jest globals are available without import
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSuperadminTenants, useTenantAction } from '@/hooks/useSuperadminTenants';

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

describe('Super-Admin hooks', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // Point API base for tests
    (process as any).env.NEXT_PUBLIC_API_BASE = 'http://api.test';
  });

  it('lists tenants via useSuperadminTenants', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ tenants: [{ id: 't1', name: 'Acme', status: 'active', createdAt: new Date().toISOString() }], total: 1 }) });
    const { result } = renderHook(() => useSuperadminTenants({ status: 'active', page: 1, limit: 10 }), { wrapper: wrapperFactory() });

    await waitFor(() => expect(result.current.isSuccess).toBeTruthy());
    expect(result.current.data?.tenants?.length).toBe(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url.endsWith('/superadmin/tenants?status=active&page=1&limit=10')).toBe(true);
  });

  it('patches tenant via useTenantAction', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    const { result } = renderHook(() => useTenantAction(), { wrapper: wrapperFactory() });

    await result.current.mutateAsync({ id: 't1', patch: { status: 'suspended' } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/superadmin/tenants/t1')).toBe(true);
    expect(init?.method).toBe('PATCH');
    expect(init?.headers).toHaveProperty('Content-Type', 'application/json');
  });
});
