import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

const mockBuildReport = jest.fn();
jest.mock('@/lib/analytics/revenue-front-desk-report', () => ({
  buildRevenueFrontDeskReport: (...args: unknown[]) => mockBuildReport(...args),
}));

jest.mock('@/lib/tenant-currency', () => ({
  getTenantCurrency: jest.fn(async () => 'NGN'),
}));

const mockCreateAdmin = jest.fn();
jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: mockCreateAdmin,
  getSupabaseRouteHandlerClient: jest.fn(() => ({})),
}));

jest.mock('@/lib/supabase/bearer-client', () => ({
  createSupabaseBearerClient: jest.fn(() => ({})),
}));

jest.mock('@/lib/monitoring/alerting', () => ({
  getAlertService: jest.fn(() => ({ sendErrorAlert: jest.fn().mockResolvedValue(undefined) })),
}));

jest.mock('@/lib/logger/api-logger', () => ({
  createApiLogger: jest.fn(() => ({ logRequest: jest.fn(), logError: jest.fn(), warn: jest.fn() })),
}));

import { GET } from '@/app/api/analytics/revenue-front-desk/route';

type LegacyInput = {
  request: NextRequest;
  user: { id: string; email: string; role: string; tenantId: string };
  supabase: { from?: jest.Mock };
};

const callGet = GET as unknown as (input: LegacyInput) => Promise<Record<string, unknown>>;
const start = '2026-08-01T00:00:00.000Z';
const end = '2026-08-15T00:00:00.000Z';
const report = {
  period: { start, end },
  currency: 'NGN',
  funnel: {},
  revenue: {},
  handling: {},
  completeness: {},
};

function legacyRequest(role: string = 'owner', url?: string): LegacyInput {
  return {
    request: new NextRequest(url ?? `http://localhost/api/analytics/revenue-front-desk?start=${start}&end=${end}`),
    user: { id: 'user-1', email: 'owner@example.com', role, tenantId: 'tenant-1' },
    supabase: {},
  };
}

function authChain(result: Record<string, unknown>) {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'eq']) query[method] = jest.fn(() => query);
  query.maybeSingle = jest.fn(async () => result);
  return query;
}

describe('GET /api/analytics/revenue-front-desk', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildReport.mockResolvedValue(report);
  });

  it.each(['owner', 'manager'])('allows %s access and returns the deterministic report', async (role) => {
    const input = legacyRequest(role);
    const result = await callGet(input);

    expect(mockBuildReport).toHaveBeenCalledWith(input.supabase, {
      tenantId: 'tenant-1',
      start,
      end,
      currency: 'NGN',
    });
    expect(result).toEqual(report);
  });

  it('denies staff through the real authenticated route boundary', async () => {
    const admin = {
      auth: {
        getUser: jest.fn(async () => ({
          data: { user: { id: 'user-1', email: 'staff@example.com' } },
          error: null,
        })),
      },
      from: jest.fn((table: string) => {
        if (table === 'tenant_users') {
          return authChain({ data: { tenant_id: 'tenant-1', role: 'staff' }, error: null });
        }
        return authChain({ data: null, error: null });
      }),
    };
    mockCreateAdmin.mockReturnValue(admin);

    const response = await GET(new NextRequest(
      `http://localhost/api/analytics/revenue-front-desk?start=${start}&end=${end}`,
      { headers: { authorization: 'Bearer token', 'x-tenant-id': 'tenant-1' } },
    ));

    expect(response.status).toBe(403);
    expect(mockBuildReport).not.toHaveBeenCalled();
  });

  it('uses the authenticated tenant despite a spoofed tenant header', async () => {
    const input = legacyRequest();
    input.request.headers.set('x-tenant-id', 'tenant-2');

    await callGet(input);

    expect(mockBuildReport).toHaveBeenCalledWith(input.supabase, expect.objectContaining({
      tenantId: 'tenant-1',
    }));
  });

  it.each([
    ['invalid ISO dates', 'start=not-a-date&end=2026-08-15T00:00:00.000Z'],
    ['end before start', 'start=2026-08-15T00:00:00.000Z&end=2026-08-01T00:00:00.000Z'],
    ['a window over 93 days', 'start=2026-01-01T00:00:00.000Z&end=2026-05-01T00:00:00.000Z'],
  ])('rejects %s', async (_label, query) => {
    await expect(callGet(legacyRequest('owner', `http://localhost/api/analytics/revenue-front-desk?${query}`)))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(mockBuildReport).not.toHaveBeenCalled();
  });
});
