import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

const mockBuildUnitEconomics = jest.fn();
jest.mock('@/lib/analytics/booka-unit-economics', () => ({
  buildBookaUnitEconomics: (...args: unknown[]) => mockBuildUnitEconomics(...args),
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

import { GET } from '@/app/api/superadmin/booka-unit-economics/route';

type LegacyInput = {
  request: NextRequest;
  user: { id: string; email: string; role: string };
  supabase: Record<string, unknown>;
};
const callGet = GET as unknown as (input: LegacyInput) => Promise<Record<string, unknown>>;
const start = '2026-08-01T00:00:00.000Z';
const end = '2026-09-01T00:00:00.000Z';
const report = {
  period: { start, end },
  tenants: [{
    tenant_id: 'tenant-1',
    recognized_revenue_credits: 100,
    provider_cost_credits: 25,
    gross_contribution_credits: 75,
    verified_outcomes: 5,
  }],
  totals: {
    recognized_revenue_credits: 100,
    provider_cost_credits: 25,
    gross_contribution_credits: 75,
    verified_outcomes: 5,
  },
};

function legacyRequest(url: string): LegacyInput {
  return {
    request: new NextRequest(url),
    user: { id: 'admin-1', email: 'admin@example.com', role: 'superadmin' },
    supabase: {},
  };
}

function authChain(result: Record<string, unknown>) {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'eq']) query[method] = jest.fn(() => query);
  query.maybeSingle = jest.fn(async () => result);
  return query;
}

describe('GET /api/superadmin/booka-unit-economics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildUnitEconomics.mockResolvedValue(report);
    mockCreateAdmin.mockReturnValue({ from: jest.fn() });
  });

  it('passes validated period and tenant filters to the internal service', async () => {
    const admin = { from: jest.fn() };
    mockCreateAdmin.mockReturnValue(admin);

    const result = await callGet(legacyRequest(
      `http://localhost/api/superadmin/booka-unit-economics?start=${start}&end=${end}&tenant_id=tenant-1`,
    ));

    expect(mockBuildUnitEconomics).toHaveBeenCalledWith(admin, {
      start,
      end,
      tenantId: 'tenant-1',
    });
    expect(result).toEqual(report);
    expect(JSON.stringify(result)).not.toMatch(/phone|message|conversation_content/i);
  });

  it('defaults to a recent period when dates are omitted', async () => {
    const admin = { from: jest.fn() };
    mockCreateAdmin.mockReturnValue(admin);

    await callGet(legacyRequest('http://localhost/api/superadmin/booka-unit-economics'));

    expect(mockBuildUnitEconomics).toHaveBeenCalledWith(admin, {
      start: expect.any(String),
      end: expect.any(String),
      tenantId: undefined,
    });
  });

  it('denies a non-superadmin at the authenticated route boundary', async () => {
    const admin = {
      auth: {
        getUser: jest.fn(async () => ({
          data: { user: { id: 'user-1', email: 'owner@example.com' } },
          error: null,
        })),
      },
      from: jest.fn(() => authChain({ data: null, error: null })),
    };
    mockCreateAdmin.mockReturnValue(admin);

    const response = await GET(new NextRequest(
      `http://localhost/api/superadmin/booka-unit-economics?start=${start}&end=${end}`,
      { headers: { authorization: 'Bearer token' } },
    ));

    expect(response.status).toBe(403);
    expect(mockBuildUnitEconomics).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid ISO date', 'start=nope&end=2026-09-01T00:00:00.000Z'],
    ['end before start', 'start=2026-09-01T00:00:00.000Z&end=2026-08-01T00:00:00.000Z'],
    ['a window over 366 days', 'start=2025-01-01T00:00:00.000Z&end=2026-08-01T00:00:00.000Z'],
  ])('rejects %s', async (_label, query) => {
    await expect(callGet(legacyRequest(`http://localhost/api/superadmin/booka-unit-economics?${query}`)))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});
