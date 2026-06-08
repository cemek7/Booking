import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type DbRow = Record<string, unknown> | null;
const responses: Array<{ data: DbRow; error: null }> = [];
const upsertCalls: Array<{ values: Record<string, unknown>; opts: Record<string, unknown> }> = [];

function pushDb(data: DbRow) { responses.push({ data, error: null }); }

function makeChain() {
  const chain: Record<string, unknown> = {};
  ['select', 'eq', 'neq', 'ilike', 'in', 'lt', 'gt', 'lte', 'gte', 'not', 'order', 'limit'].forEach(m => {
    (chain as any)[m] = jest.fn().mockReturnValue(chain);
  });
  (chain as any).maybeSingle = jest.fn().mockImplementation(() => Promise.resolve(responses.shift() ?? { data: null, error: null }));
  (chain as any).single = jest.fn().mockImplementation(() => Promise.resolve(responses.shift() ?? { data: null, error: null }));
  (chain as any).upsert = jest.fn().mockImplementation((values: any, opts: any) => {
    upsertCalls.push({ values, opts });
    return chain;
  });
  (chain as any).insert = jest.fn().mockResolvedValue({ data: null, error: null });
  (chain as any).update = jest.fn().mockReturnValue(chain);
  return chain;
}

const mockClient = { from: jest.fn().mockImplementation(() => makeChain()) };
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => mockClient) }));

import { ensureConversation } from '@/lib/whatsapp/v2/conversationState';

beforeEach(() => { responses.length = 0; upsertCalls.length = 0; });

describe('ensureConversation channel-awareness', () => {
  it('writes an Instagram row keyed on (channel, external_id) with null phone', async () => {
    pushDb({ id: 'c1', tenant_id: 't1', phone_number: null, external_id: 'IGSID_1', channel: 'instagram', role: 'customer', current_flow: 'idle', flow_step: 0, flow_data: {} });
    await ensureConversation('IGSID_1', 't1', 'customer', 'instagram');
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].values).toMatchObject({ channel: 'instagram', external_id: 'IGSID_1', phone_number: null, tenant_id: 't1' });
    expect(upsertCalls[0].opts).toMatchObject({ onConflict: 'tenant_id,channel,external_id' });
  });

  it('defaults to WhatsApp: writes phone_number and conflicts on phone_number,tenant_id', async () => {
    pushDb({ id: 'c2', tenant_id: 't1', phone_number: '+2348000000000', external_id: '+2348000000000', channel: 'whatsapp', role: 'customer', current_flow: 'idle', flow_step: 0, flow_data: {} });
    await ensureConversation('+2348000000000', 't1', 'customer');
    expect(upsertCalls[0].values).toMatchObject({ channel: 'whatsapp', external_id: '+2348000000000', phone_number: '+2348000000000' });
    expect(upsertCalls[0].opts).toMatchObject({ onConflict: 'phone_number,tenant_id' });
  });
});
