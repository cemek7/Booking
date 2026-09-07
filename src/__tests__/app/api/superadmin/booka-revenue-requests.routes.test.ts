import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(),
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

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { GET } from '@/app/api/superadmin/booka-revenue-requests/route';
import { PATCH } from '@/app/api/superadmin/booka-revenue-requests/[id]/route';

type LegacyInput = ReturnType<typeof legacyRequest> & { params?: { id: string } };
const callGet = GET as unknown as (input: LegacyInput) => Promise<{
  data: Array<Record<string, unknown>>;
  total: number;
}>;
const callPatch = PATCH as unknown as (input: LegacyInput) => Promise<{
  data: Record<string, unknown>;
}>;

function chain(result: Record<string, unknown>) {
  const query: Record<string, jest.Mock> & PromiseLike<unknown> = {
    select: jest.fn(),
    eq: jest.fn(),
    not: jest.fn(),
    order: jest.fn(),
    range: jest.fn(),
    update: jest.fn(),
    maybeSingle: jest.fn(async () => result),
    single: jest.fn(async () => result),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  } as Record<string, jest.Mock> & PromiseLike<unknown>;

  for (const method of ['select', 'eq', 'not', 'order', 'range', 'update'] as const) {
    query[method].mockReturnValue(query);
  }
  return query;
}

function legacyRequest(url: string, method = 'GET', body?: unknown) {
  return {
    request: new NextRequest(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
    user: { id: 'admin_1', email: 'admin@example.com', role: 'superadmin' },
    supabase: {},
  };
}

const validAuditSummary = {
  enquiries_reviewed: 50,
  unanswered_or_delayed: 8,
  missing_next_step: 10,
  availability_dead_ends: 3,
  missing_follow_ups: 12,
  missed_recommendations: 7,
  opportunity_low_ngn: 100000,
  opportunity_high_ngn: 250000,
  assumptions: ['Average transaction value supplied by the applicant.'],
};

describe('superadmin Booka revenue request routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enforces superadmin-only access', async () => {
    const admins = chain({ data: null, error: null });
    (createSupabaseAdminClient as jest.Mock).mockReturnValue({
      auth: {
        getUser: jest.fn(async () => ({
          data: { user: { id: 'user_1', email: 'user@example.com' } },
          error: null,
        })),
      },
      from: jest.fn(() => admins),
    });

    const response = await GET(new NextRequest('http://localhost/api/superadmin/booka-revenue-requests', {
      headers: { authorization: 'Bearer user-token' },
    }));

    expect(response.status).toBe(403);
  });

  it('applies request_type and status filters with newest-first ordering', async () => {
    const requests = chain({
      data: [{ id: 'req_1', request_type: 'revenue_pilot', status: 'qualified' }],
      error: null,
      count: 1,
    });
    (createSupabaseAdminClient as jest.Mock).mockReturnValue({ from: jest.fn(() => requests) });

    const result = await callGet(legacyRequest(
      'http://localhost/api/superadmin/booka-revenue-requests?request_type=revenue_pilot&status=qualified&page=1&limit=20',
    ));

    expect(requests.eq).toHaveBeenCalledWith('request_type', 'revenue_pilot');
    expect(requests.eq).toHaveBeenCalledWith('status', 'qualified');
    expect(requests.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result).toEqual({
      data: [{ id: 'req_1', request_type: 'revenue_pilot', status: 'qualified' }],
      total: 1,
    });
  });

  it('rejects an invalid PATCH status', async () => {
    (createSupabaseAdminClient as jest.Mock).mockReturnValue({ from: jest.fn() });

    await expect(callPatch({
      ...legacyRequest('http://localhost/api/superadmin/booka-revenue-requests/req_1', 'PATCH', {
        status: 'not_a_status',
      }),
      params: { id: 'req_1' },
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects an audit summary whose high opportunity is below its low opportunity', async () => {
    (createSupabaseAdminClient as jest.Mock).mockReturnValue({ from: jest.fn() });

    await expect(callPatch({
      ...legacyRequest('http://localhost/api/superadmin/booka-revenue-requests/req_1', 'PATCH', {
        audit_summary: {
          ...validAuditSummary,
          opportunity_low_ngn: 300000,
          opportunity_high_ngn: 100000,
        },
      }),
      params: { id: 'req_1' },
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects audit summaries on revenue pilot records', async () => {
    const requests = chain({
      data: { id: 'req_1', request_type: 'revenue_pilot', status: 'new' },
      error: null,
    });
    (createSupabaseAdminClient as jest.Mock).mockReturnValue({ from: jest.fn(() => requests) });

    await expect(callPatch({
      ...legacyRequest('http://localhost/api/superadmin/booka-revenue-requests/req_1', 'PATCH', {
        audit_summary: validAuditSummary,
      }),
      params: { id: 'req_1' },
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('saves a valid audit summary and transitions the request to audit_ready', async () => {
    const requests = chain({
      data: { id: 'req_2', request_type: 'missed_revenue_report', status: 'audit_ready' },
      error: null,
    });
    (createSupabaseAdminClient as jest.Mock).mockReturnValue({ from: jest.fn(() => requests) });

    const result = await callPatch({
      ...legacyRequest('http://localhost/api/superadmin/booka-revenue-requests/req_2', 'PATCH', {
        audit_summary: validAuditSummary,
      }),
      params: { id: 'req_2' },
    });

    expect(requests.update).toHaveBeenCalledWith(expect.objectContaining({
      audit_summary: validAuditSummary,
      status: 'audit_ready',
    }));
    expect(result).toMatchObject({ data: { id: 'req_2', status: 'audit_ready' } });
  });
});
