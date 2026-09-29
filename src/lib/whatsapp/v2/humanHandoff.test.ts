import { describe, it, expect } from '@jest/globals';
import { wantsHuman, createHumanHandoff, type HumanHandoffStore } from '@/lib/whatsapp/v2/humanHandoff';

describe('wantsHuman', () => {
  it.each(['agent', 'I want a HUMAN', 'can I talk to a person?', 'speak with someone', 'real person please'])(
    'detects handoff intent: %s',
    (msg) => expect(wantsHuman(msg)).toBe(true),
  );

  it.each(['book an appointment', 'what are your prices?', 'cancel my booking'])(
    'ignores normal messages: %s',
    (msg) => expect(wantsHuman(msg)).toBe(false),
  );
});

function makeStore(existing: { id: string; status?: string } | null) {
  const inserted: unknown[] = [];
  const store: HumanHandoffStore = {
    loadCanonicalThread: async () => ({
      id: 'thread-1', status: 'active', state_version: 1,
      structured_state: { confirmed: {}, proposed: {}, missing: [] }, rolling_summary: null,
    }),
    findOpen: async () => existing,
    insert: async (payload) => { inserted.push(payload); return { id: 'new-ticket' }; },
  };
  return { store, inserted };
}

describe('createHumanHandoff', () => {
  it('inserts a pending ticket when none is open', async () => {
    const { store, inserted } = makeStore(null);
    const result = await createHumanHandoff({
      tenantId: 't1', customerPhone: '234800', sessionId: 's1', threadId: 'thread-1',
    }, store);
    expect(result).toEqual({ id: 'new-ticket' });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ tenant_id: 't1', customer_phone: '234800', status: 'pending' });
  });

  it('returns the existing open ticket without inserting (dedup)', async () => {
    const { store, inserted } = makeStore({ id: 'existing-ticket', status: 'pending' });
    const result = await createHumanHandoff({
      tenantId: 't1', customerPhone: '234800', sessionId: 's1', threadId: 'thread-1',
    }, store);
    expect(result).toEqual({ id: 'existing-ticket', status: 'pending' });
    expect(inserted).toHaveLength(0);
  });
});
