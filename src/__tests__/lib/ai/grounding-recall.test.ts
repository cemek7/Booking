import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const recallSentinel = {
  lastService: 'Trim',
  usualStaff: 'Sarah',
  lastVisitAt: '2026-06-01T10:00:00.000Z',
  visitCount: 3,
  rebookingDue: false,
};

const getCustomerRecall = jest.fn();
const getAvailableSlots = jest.fn();
const from = jest.fn((table: string) => {
  const rowsByTable: Record<string, unknown> = {
    tenants: {
      id: 'tenant-1',
      name: 'Test Salon',
      metadata: {},
      tone_config: null,
      buffer_minutes: 15,
      timezone: 'Africa/Lagos',
    },
    services: [],
    tenant_users: [],
  };

  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    maybeSingle: async () => ({ data: rowsByTable[table] ?? null, error: null }),
    then: (resolve: any, reject: any) =>
      Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(resolve, reject),
  };

  return chain;
});

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from })),
}));

// grounding-service reaches the DB through createSupabaseAdminClient() in
// @/lib/supabase/server, not createClient from @supabase/supabase-js.
jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(() => ({ from })),
}));

jest.mock('@/lib/ai/customerRecall', () => ({
  getCustomerRecall: (...args: unknown[]) => getCustomerRecall(...args),
}));

jest.mock('@/lib/whatsapp/v2/slotEngine', () => ({
  getAvailableSlots: (...args: unknown[]) => getAvailableSlots(...args),
}));

import { getGroundingData } from '@/lib/ai/grounding-service';

describe('getGroundingData recall wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getCustomerRecall.mockResolvedValue(recallSentinel);
    getAvailableSlots.mockResolvedValue([]);
  });

  it('attaches customerRecall for a customer with a phone', async () => {
    const result = await getGroundingData(
      'tenant-1',
      'hi there',
      {
        id: 'conv-1',
        tenant_id: 'tenant-1',
        phone_number: '+2348000000000',
        external_id: '+2348000000000',
        channel: 'whatsapp',
        role: 'customer',
        current_flow: 'idle',
        flow_step: 0,
        flow_data: {},
        last_inbound_at: null,
        opted_out_at: null,
      },
      { intent: 'customer_support', confidence: 'high', source: 'rules' },
    );

    expect(result.customerRecall).toEqual(recallSentinel);
    expect(getCustomerRecall).toHaveBeenCalledWith(expect.anything(), 'tenant-1', '+2348000000000');
  });

  it('skips recall for owners', async () => {
    const result = await getGroundingData(
      'tenant-1',
      'hi there',
      {
        id: 'conv-1',
        tenant_id: 'tenant-1',
        phone_number: '+2348000000000',
        external_id: '+2348000000000',
        channel: 'whatsapp',
        role: 'owner',
        current_flow: 'idle',
        flow_step: 0,
        flow_data: {},
        last_inbound_at: null,
        opted_out_at: null,
      },
      { intent: 'customer_support', confidence: 'high', source: 'rules' },
    );

    expect(result.customerRecall).toBeNull();
    expect(getCustomerRecall).not.toHaveBeenCalled();
  });

  it('skips recall when the customer has no phone number', async () => {
    const result = await getGroundingData(
      'tenant-1',
      'hello',
      {
        id: 'conv-1',
        tenant_id: 'tenant-1',
        phone_number: null,
        external_id: 'ig-user-1',
        channel: 'instagram',
        role: 'customer',
        current_flow: 'idle',
        flow_step: 0,
        flow_data: {},
        last_inbound_at: null,
        opted_out_at: null,
      },
      { intent: 'customer_support', confidence: 'high', source: 'rules' },
    );

    expect(result.customerRecall).toBeNull();
    expect(getCustomerRecall).not.toHaveBeenCalled();
  });
});
