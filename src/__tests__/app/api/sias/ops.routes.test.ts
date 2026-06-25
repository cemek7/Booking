import { describe, expect, beforeEach, jest, it } from '@jest/globals';
import { NextRequest } from 'next/server';
import { GET as getSiasOps } from '@/app/api/sias/ops/route';
import { PATCH as patchEscalation } from '@/app/api/escalation/[id]/route';
import { POST as runCampaigns } from '@/app/api/campaigns/run/route';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { createSupabaseBearerClient } from '@/lib/supabase/bearer-client';
import { siasOperations } from '@/lib/sias-operations';
import { runDueSiasCampaigns } from '@/lib/siasCampaignRunner';

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(),
  getSupabaseRouteHandlerClient: jest.fn(),
  createServerSupabaseClient: jest.fn(),
}));

jest.mock('@/lib/supabase/bearer-client', () => ({
  createSupabaseBearerClient: jest.fn(),
}));

jest.mock('@/lib/sias-operations', () => ({
  siasOperations: {
    updateEscalationTicket: jest.fn(),
  },
}));

jest.mock('@/lib/siasCampaignRunner', () => ({
  runDueSiasCampaigns: jest.fn(),
}));

type QueryResponse = {
  data: unknown;
  error: null;
};

type MockQuery = {
  select: jest.Mock<MockQuery, []>;
  eq: jest.Mock<MockQuery, [string, string | number | boolean | null]>;
  order: jest.Mock<MockQuery, [string, { ascending?: boolean }?]>;
  limit: jest.Mock<MockQuery, [number]>;
  gte: jest.Mock<MockQuery, [string, string]>;
  lte: jest.Mock<MockQuery, [string, string]>;
  in: jest.Mock<MockQuery, [string, unknown[]]>;
  maybeSingle: jest.Mock<Promise<QueryResponse>, []>;
  then: (resolve: (value: QueryResponse) => unknown) => unknown;
};

function makeQuery(response: QueryResponse): MockQuery {
  const query = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    order: jest.fn(() => query),
    limit: jest.fn(() => query),
    gte: jest.fn(() => query),
    lte: jest.fn(() => query),
    in: jest.fn(() => query),
    maybeSingle: jest.fn(async () => response),
    then: (resolve: (value: QueryResponse) => unknown) => resolve(response),
  } satisfies MockQuery;

  return query;
}

function createOpsSupabaseMock() {
  const campaignRows = [
    {
      id: 'camp-1',
      campaign_type: 'reactivation',
      action: 'send_reactivation',
      target_phone: '+2348010000001',
      status: 'pending',
      attempts: 0,
      scheduled_for: '2026-05-19T08:00:00.000Z',
      next_retry_at: null,
      source_event: 'customer_dormant',
      metadata: { channel: 'whatsapp' },
      error: null,
      created_at: '2026-05-19T08:00:00.000Z',
    },
    {
      id: 'camp-2',
      campaign_type: 'reminder',
      action: 'send_reminder',
      target_phone: '+2348010000002',
      status: 'retry_scheduled',
      attempts: 1,
      scheduled_for: '2026-05-18T08:00:00.000Z',
      next_retry_at: '2026-05-19T10:00:00.000Z',
      source_event: 'booking_created',
      metadata: { channel: 'whatsapp' },
      error: 'temporary failure',
      created_at: '2026-05-18T08:00:00.000Z',
    },
    {
      id: 'camp-3',
      campaign_type: 'review',
      action: 'request_review',
      target_phone: '+2348010000003',
      status: 'sent',
      attempts: 1,
      scheduled_for: '2026-05-18T08:00:00.000Z',
      next_retry_at: null,
      source_event: 'booking_completed',
      metadata: { channel: 'whatsapp' },
      error: null,
      created_at: '2026-05-18T08:00:00.000Z',
    },
  ];

  const escalationRows = [
    {
      id: 'esc-1',
      customer_phone: '+2348010000101',
      session_id: 'session-1',
      reason: 'refund_request',
      status: 'pending',
      assigned_agent_id: null,
      created_at: '2026-05-20T07:00:00.000Z',
      resolved_at: null,
    },
    {
      id: 'esc-2',
      customer_phone: '+2348010000102',
      session_id: 'session-2',
      reason: 'angry_customer',
      status: 'claimed',
      assigned_agent_id: 'agent-9',
      created_at: '2026-05-20T07:30:00.000Z',
      resolved_at: null,
    },
    {
      id: 'esc-3',
      customer_phone: '+2348010000103',
      session_id: 'session-3',
      reason: 'payment_issue',
      status: 'resolved',
      assigned_agent_id: 'agent-2',
      created_at: '2026-05-19T06:00:00.000Z',
      resolved_at: '2026-05-19T08:00:00.000Z',
    },
  ];

  const memoryRows = [
    {
      id: 'mem-1',
      memory_key: 'preferred_reminder_time',
      memory_value: { hour: 9, format: 'morning' },
      source: 'campaign',
      confidence: 0.9,
      hit_count: 4,
      last_seen_at: '2026-05-20T06:00:00.000Z',
      updated_at: '2026-05-20T06:00:00.000Z',
    },
  ];

  const attributionRows = [
    {
      signal: 'revenue_recovery',
      value: 2000,
      source_event: 'campaign.run',
      attributed_to: 'send_reactivation',
      created_at: '2026-05-19T10:00:00.000Z',
    },
    {
      signal: 'revenue_recovery',
      value: 3000,
      source_event: 'campaign.run',
      attributed_to: 'send_reactivation',
      created_at: '2026-05-20T12:00:00.000Z',
    },
    {
      signal: 'repeat_booking_lift',
      value: 5,
      source_event: 'campaign.run',
      attributed_to: 'request_review',
      created_at: '2026-05-20T12:30:00.000Z',
    },
  ];

  const tables: Record<string, MockQuery> = {
    sias_campaign_runs: makeQuery({ data: campaignRows, error: null }),
    escalation_queue: makeQuery({ data: escalationRows, error: null }),
    sias_operational_memory: makeQuery({ data: memoryRows, error: null }),
    sias_outcome_attributions: makeQuery({ data: attributionRows, error: null }),
  };

  return {
    from: jest.fn((table: string) => tables[table] ?? makeQuery({ data: [], error: null })),
    __tables: tables,
  };
}

function createAdminClientMock() {
  const tenantUsersQuery = makeQuery({
    data: { tenant_id: 'tenant-123', role: 'owner' },
    error: null,
  });

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'user-123', email: 'owner@example.com' } },
        error: null,
      }),
    },
    from: jest.fn((table: string) => {
      if (table === 'tenant_users') return tenantUsersQuery;
      return makeQuery({ data: null, error: null });
    }),
    __tenantUsersQuery: tenantUsersQuery,
  };
}

function makeAuthedRequest(url: string, body?: unknown, method: 'GET' | 'POST' | 'PATCH' = 'GET') {
  return new NextRequest(url, {
    method,
    headers: {
      authorization: 'Bearer test-token',
      'x-tenant-id': 'tenant-123',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('SIAS ops routes', () => {
  const opsSupabase = createOpsSupabaseMock();
  const adminClient = createAdminClientMock();

  beforeEach(() => {
    jest.clearAllMocks();
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(adminClient);
    (createSupabaseBearerClient as jest.Mock).mockReturnValue(opsSupabase);
  });

  it('returns the SIAS ops snapshot with revenue recovery rollups', async () => {
    const response = await getSiasOps(makeAuthedRequest('http://localhost:3000/api/sias/ops') as unknown as NextRequest);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.totals).toEqual({
      open_escalations: 2,
      retrying_campaigns: 1,
      pending_campaigns: 1,
    });
    expect(json.campaigns).toHaveLength(3);
    expect(json.escalations).toHaveLength(3);
    expect(json.memory).toHaveLength(1);
    expect(json.revenue_recovered_by_day).toEqual([
      { day: '2026-05-19', revenue: 2000, count: 1 },
      { day: '2026-05-20', revenue: 3000, count: 1 },
    ]);
    expect(json.outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'revenue_recovery', count: 2, value: 5000 }),
        expect.objectContaining({ id: 'repeat_booking_lift', count: 1, value: 5 }),
      ])
    );
  });

  it('claims an escalation ticket from the ops page action', async () => {
    (siasOperations.updateEscalationTicket as jest.Mock).mockResolvedValue({
      id: 'esc-1',
      status: 'claimed',
      assigned_agent_id: 'user-123',
    });

    const response = await patchEscalation(
      makeAuthedRequest('http://localhost:3000/api/escalation/esc-1', { action: 'claim' }, 'PATCH') as unknown as NextRequest,
      { params: { id: 'esc-1' } } as { params: { id: string } }
    );

    expect(response.status).toBe(200);
    expect(siasOperations.updateEscalationTicket).toHaveBeenCalledWith({
      tenantId: 'tenant-123',
      escalationId: 'esc-1',
      action: 'claim',
      agentId: 'user-123',
    });

    const json = await response.json();
    expect(json.escalation).toMatchObject({ id: 'esc-1', status: 'claimed' });
  });

  it('resolves an escalation ticket from the ops page action', async () => {
    (siasOperations.updateEscalationTicket as jest.Mock).mockResolvedValue({
      id: 'esc-2',
      status: 'resolved',
      assigned_agent_id: 'user-123',
    });

    const response = await patchEscalation(
      makeAuthedRequest('http://localhost:3000/api/escalation/esc-2', { action: 'resolve' }, 'PATCH') as unknown as NextRequest,
      { params: { id: 'esc-2' } } as { params: { id: string } }
    );

    expect(response.status).toBe(200);
    expect(siasOperations.updateEscalationTicket).toHaveBeenCalledWith({
      tenantId: 'tenant-123',
      escalationId: 'esc-2',
      action: 'resolve',
      agentId: 'user-123',
    });

    const json = await response.json();
    expect(json.escalation).toMatchObject({ id: 'esc-2', status: 'resolved' });
  });

  it('re-runs a specific campaign from the ops page', async () => {
    (runDueSiasCampaigns as jest.Mock).mockResolvedValue({
      processed: 1,
      delivered: 1,
      failed: 0,
    });

    const response = await runCampaigns(
      makeAuthedRequest('http://localhost:3000/api/campaigns/run', { campaignId: 'camp-2' }, 'POST') as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(runDueSiasCampaigns).toHaveBeenCalledWith(opsSupabase, 'tenant-123', 25, {
      campaignId: 'camp-2',
    });

    const json = await response.json();
    expect(json).toEqual({
      processed: 1,
      delivered: 1,
      failed: 0,
    });
  });
});
