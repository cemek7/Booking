import { describe, expect, it, jest } from '@jest/globals';

const from = jest.fn();

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(() => ({ from })),
}));

import { GET } from '@/app/api/tenants/[tenantId]/whatsapp/meta/health/route';

function context(
  tenantId = 'tenant-1',
  user = { id: 'owner-1', email: 'owner@example.com', role: 'owner', tenantId: 'tenant-1' }
) {
  return {
    request: {
      headers: new Headers(),
      method: 'GET',
      url: `http://booka.test/api/tenants/${tenantId}/whatsapp/meta/health`,
    },
    params: { tenantId },
    user,
    supabase: {} as never,
  };
}

describe('Meta WhatsApp channel health', () => {
  beforeEach(() => {
    from.mockReset();
  });

  it('rejects a tenant owner requesting another tenant health before any privileged query', async () => {
    await expect(GET(context('tenant-2') as never)).rejects.toMatchObject({ statusCode: 403 });
    expect(from).not.toHaveBeenCalled();
  });

  it('allows a global superadmin to target a tenant without tenant membership', async () => {
    const admin = { id: 'admin-1', email: 'admin@example.com', role: 'superadmin' };
    // The first privileged read is intentionally reached. The query itself is
    // not completed here: this test exercises the explicit cross-tenant gate.
    from.mockImplementationOnce(() => { throw new Error('query reached'); });
    await expect(GET(context('tenant-2', admin) as never)).rejects.toThrow('query reached');
    expect(from).toHaveBeenCalledWith('whatsapp_configurations');
  });

  it('returns redacted operational health without exposing a stored provider error', async () => {
    const countQuery = (count: number) => {
      const result = Promise.resolve({ data: null, error: null, count });
      const query = {
        eq: jest.fn(() => query),
        then: result.then.bind(result),
      };
      return query;
    };
    const connection = {
      select: jest.fn(() => connection),
      eq: jest.fn(() => connection),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          active: true,
          agent_enabled: true,
          meta_connection_status: 'connected',
          meta_last_error: 'OpenRouter rejected bearer token secret-value',
          meta_last_validated_at: '2026-08-12T12:00:00.000Z',
          meta_webhook_subscribed_at: '2026-08-12T12:00:00.000Z',
        },
        error: null,
      }),
    };
    let countIndex = 0;
    const queue = {
      select: jest.fn((columns: string) => {
        if (columns === 'id') return countQuery([2, 1, 3, 4][countIndex++]!);
        return queue;
      }),
      eq: jest.fn(() => queue),
      order: jest.fn(() => queue),
      limit: jest.fn(() => queue),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          status: 'failed',
          created_at: '2026-08-12T12:01:00.000Z',
          processed_at: null,
          error_message: 'OpenRouter rejected bearer token secret-value',
        },
        error: null,
      }),
    };
    const conversation = {
      select: jest.fn(() => conversation),
      eq: jest.fn(() => conversation),
      not: jest.fn(() => conversation),
      order: jest.fn(() => conversation),
      limit: jest.fn(() => conversation),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { last_inbound_at: '2026-08-12T12:00:00.000Z', flow_data: {} },
        error: null,
      }),
    };
    from.mockImplementation((table: string) => {
      if (table === 'whatsapp_configurations') return connection;
      if (table === 'whatsapp_message_queue') return queue;
      if (table === 'whatsapp_conversations') return conversation;
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await GET(context() as never);

    expect(result).toMatchObject({
      connection: { status: 'connected' },
      automation: { state: 'attention', recentFailure: 'AI provider needs attention' },
      queue: { pending: 2, processing: 1, retrying: 3, failed: 4 },
    });
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });
});
