type EqCall = { table: string; phase: string; column: string; value: unknown };

const eqCalls: EqCall[] = [];

function chainFor(table: string) {
  let phase = 'select';
  const chain: Record<string, unknown> = {};
  chain.select = jest.fn(() => { phase = 'select'; return chain; });
  chain.update = jest.fn(() => { phase = 'update'; return chain; });
  chain.insert = jest.fn(async () => ({ error: null }));
  chain.eq = jest.fn((column: string, value: unknown) => {
    eqCalls.push({ table, phase, column, value });
    return chain;
  });
  chain.single = jest.fn(async () => {
    if (table === 'whatsapp_sessions') {
      return {
        data: {
          state: {
            reservationId: 'reservation-1',
            step: 'awaiting_feedback',
            ratings: { overallRating: 5 },
            attempts: 0,
          },
          metadata: { staff_name: 'Ada', service_name: 'Braids' },
        },
        error: null,
      };
    }
    if (table === 'reservations') {
      return {
        data: {
          tenant_id: 'tenant-a', customer_id: 'customer-1', staff_id: 'staff-1', service_id: 'service-1',
        },
        error: null,
      };
    }
    return { data: null, error: null };
  });
  return chain;
}

const mockClient = {
  from: jest.fn((table: string) => chainFor(table)),
  rpc: jest.fn(async () => ({ data: null, error: null })),
};

jest.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => mockClient,
}));
jest.mock('@/lib/whatsapp/evolutionClient', () => ({ getTenantWhatsAppConfig: jest.fn() }));
jest.mock('@/lib/whatsapp/providers', () => ({ getProviderClient: jest.fn() }));

import { ReviewCollectionAgent } from '@/lib/ai/reviewCollectionAgent';

describe('ReviewCollectionAgent tenant isolation', () => {
  beforeEach(() => {
    eqCalls.length = 0;
    jest.clearAllMocks();
  });

  it('keeps the state update and reservation lookup inside the resolved tenant', async () => {
    const agent = new ReviewCollectionAgent();
    await agent.processReviewResponse('tenant-a', '+2348000000000', 'Everything was excellent');

    expect(eqCalls).toContainEqual({
      table: 'whatsapp_sessions', phase: 'update', column: 'tenant_id', value: 'tenant-a',
    });
    expect(eqCalls).toContainEqual({
      table: 'reservations', phase: 'select', column: 'tenant_id', value: 'tenant-a',
    });
  });
});
