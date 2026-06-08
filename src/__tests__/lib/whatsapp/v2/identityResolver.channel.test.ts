import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type DbRow = Record<string, unknown> | null;
const responses: Array<{ data: DbRow; error: null }> = [];
function pushList(rows: Array<Record<string, unknown>>) { responses.push({ data: rows as any, error: null }); }
function pushOne(row: DbRow) { responses.push({ data: row, error: null }); }

function makeChain() {
  const chain: Record<string, unknown> = {};
  ['select', 'eq', 'neq', 'ilike', 'in', 'lt', 'gt', 'lte', 'gte', 'not', 'order'].forEach(m => {
    (chain as any)[m] = jest.fn().mockReturnValue(chain);
  });
  (chain as any).limit = jest.fn().mockImplementation(() => Promise.resolve(responses.shift() ?? { data: [], error: null }));
  (chain as any).maybeSingle = jest.fn().mockImplementation(() => Promise.resolve(responses.shift() ?? { data: null, error: null }));
  return chain;
}
const mockClient = { from: jest.fn().mockImplementation(() => makeChain()) };
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => mockClient) }));

import { resolveIncoming } from '@/lib/whatsapp/v2/identityResolver';

beforeEach(() => { responses.length = 0; });

describe('resolveIncoming Instagram', () => {
  it('resolves an existing IG conversation to its tenant as customer', async () => {
    pushList([{ tenant_id: 't9', role: 'customer' }]); // Step 1 existing-conversation lookup
    const r = await resolveIncoming('instagram', 'IGSID_9', 'hi do you have space saturday');
    expect(r.tenantId).toBe('t9');
    expect(r.role).toBe('customer');
  });

  it('returns null tenant for an unknown IG sender (webhook supplies tenant)', async () => {
    pushList([]); // no existing conversation
    const r = await resolveIncoming('instagram', 'IGSID_NEW', 'GLOW12 hello');
    expect(r.tenantId).toBeNull();
    expect(r.routingCodeFound).toBe(false); // routing codes are WhatsApp-only
  });
});
