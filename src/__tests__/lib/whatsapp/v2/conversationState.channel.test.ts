import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type DbRow = Record<string, unknown> | null;
type DbResponse = { data: DbRow; error: null };
type FluentMethod = (...args: unknown[]) => MockChain;
type MockChain = {
  select: FluentMethod;
  eq: FluentMethod;
  neq: FluentMethod;
  ilike: FluentMethod;
  in: FluentMethod;
  lt: FluentMethod;
  gt: FluentMethod;
  lte: FluentMethod;
  gte: FluentMethod;
  not: FluentMethod;
  order: FluentMethod;
  limit: FluentMethod;
  maybeSingle: () => Promise<DbResponse>;
  single: () => Promise<DbResponse>;
  upsert: (values: Record<string, unknown>, opts: Record<string, unknown>) => MockChain;
  insert: () => Promise<DbResponse>;
  update: FluentMethod;
};
const responses: DbResponse[] = [];
const upsertCalls: Array<{ values: Record<string, unknown>; opts: Record<string, unknown> }> = [];

function pushDb(data: DbRow) { responses.push({ data, error: null }); }

function makeChain() {
  const chain = {} as MockChain;
  const fluentMethods: Array<keyof Pick<MockChain, 'select' | 'eq' | 'neq' | 'ilike' | 'in' | 'lt' | 'gt' | 'lte' | 'gte' | 'not' | 'order' | 'limit' | 'update'>> = [
    'select', 'eq', 'neq', 'ilike', 'in', 'lt', 'gt', 'lte', 'gte', 'not', 'order', 'limit', 'update',
  ];
  fluentMethods.forEach(method => {
    chain[method] = jest.fn().mockReturnValue(chain);
  });
  chain.maybeSingle = jest.fn().mockImplementation(() => Promise.resolve(responses.shift() ?? { data: null, error: null }));
  chain.single = jest.fn().mockImplementation(() => Promise.resolve(responses.shift() ?? { data: null, error: null }));
  chain.upsert = jest.fn().mockImplementation((values: Record<string, unknown>, opts: Record<string, unknown>) => {
    upsertCalls.push({ values, opts });
    return chain;
  });
  chain.insert = jest.fn().mockResolvedValue({ data: null, error: null });
  return chain;
}

const mockClient = { from: jest.fn().mockImplementation(() => makeChain()) };
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => mockClient) }));
// The v2 modules reach the database via createSupabaseAdminClient() in
// @/lib/supabase/server, not createClient from @supabase/supabase-js.
jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(() => mockClient),
}));

import { ensureConversation } from '@/lib/whatsapp/v2/conversationState';

beforeEach(() => { responses.length = 0; upsertCalls.length = 0; });

describe('ensureConversation channel-awareness', () => {
  it('writes an Instagram row keyed on (channel, external_id) with null phone', async () => {
    // M2: capture the return value and assert it matches the DB row
    const igRow = { id: 'c1', tenant_id: 't1', phone_number: null, external_id: 'IGSID_1', channel: 'instagram', role: 'customer', current_flow: 'idle', flow_step: 0, flow_data: {}, last_inbound_at: null, opted_out_at: null };
    pushDb(igRow);
    const result = await ensureConversation('IGSID_1', 't1', 'customer', 'instagram');
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].values).toMatchObject({ channel: 'instagram', external_id: 'IGSID_1', phone_number: null, tenant_id: 't1' });
    expect(upsertCalls[0].opts).toMatchObject({ onConflict: 'tenant_id,channel,external_id' });
    // M2: assert the returned row has the right channel and external_id
    expect(result).toMatchObject({ channel: 'instagram', external_id: 'IGSID_1' });
  });

  it('defaults to WhatsApp: writes phone_number and conflicts on phone_number,tenant_id', async () => {
    pushDb({ id: 'c2', tenant_id: 't1', phone_number: '+2348000000000', external_id: '+2348000000000', channel: 'whatsapp', role: 'customer', current_flow: 'idle', flow_step: 0, flow_data: {} });
    await ensureConversation('+2348000000000', 't1', 'customer');
    expect(upsertCalls[0].values).toMatchObject({ channel: 'whatsapp', external_id: '+2348000000000', phone_number: '+2348000000000' });
    expect(upsertCalls[0].opts).toMatchObject({ onConflict: 'phone_number,tenant_id' });
  });

  // M1: conflict/fallback-read path — upsert single() returns {data:null} (ignoreDuplicates hit),
  // then getConversation falls back to maybeSingle() which returns the existing row.
  it('falls back to getConversation when upsert ignoreDuplicates returns null (conflict)', async () => {
    // First response: single() called after upsert — simulates ignoreDuplicates conflict (no row returned)
    pushDb(null);
    // Second response: maybeSingle() called by getConversation fallback — returns existing row
    const existingRow = { id: 'c3', tenant_id: 't1', phone_number: null, external_id: 'IGSID_2', channel: 'instagram', role: 'customer', current_flow: 'idle', flow_step: 0, flow_data: {}, last_inbound_at: null, opted_out_at: null };
    pushDb(existingRow);
    const result = await ensureConversation('IGSID_2', 't1', 'customer', 'instagram');
    // Should have attempted the upsert
    expect(upsertCalls).toHaveLength(1);
    // Should return the row fetched by the fallback getConversation
    expect(result).toMatchObject({ channel: 'instagram', external_id: 'IGSID_2' });
  });
});
