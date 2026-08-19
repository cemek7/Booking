import { describe, it, expect } from '@jest/globals';
import { wantsHuman, createHumanHandoff } from '@/lib/whatsapp/v2/humanHandoff';

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

function makeAdmin(existing: unknown) {
  const inserted: unknown[] = [];
  const admin = {
    from() {
      const builder: Record<string, unknown> = {
        select() { return builder; },
        insert(payload: unknown) { inserted.push(payload); return builder; },
        eq() { return builder; },
        gte() { return builder; },
        in() { return builder; },
        limit() { return builder; },
        maybeSingle() {
          if (inserted.length > 0) return Promise.resolve({ data: { id: 'new-ticket' }, error: null });
          return Promise.resolve({ data: existing, error: null });
        },
      };
      return builder;
    },
  };
  return { admin: admin as never, inserted };
}

describe('createHumanHandoff', () => {
  it('inserts a pending ticket when none is open', async () => {
    const { admin, inserted } = makeAdmin(null);
    const result = await createHumanHandoff(admin, { tenantId: 't1', customerPhone: '234800', sessionId: 's1' });
    expect(result).toEqual({ id: 'new-ticket' });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ tenant_id: 't1', customer_phone: '234800', status: 'pending' });
  });

  it('returns the existing open ticket without inserting (dedup)', async () => {
    const { admin, inserted } = makeAdmin({ id: 'existing-ticket', status: 'pending' });
    const result = await createHumanHandoff(admin, { tenantId: 't1', customerPhone: '234800', sessionId: 's1' });
    expect(result).toEqual({ id: 'existing-ticket', status: 'pending' });
    expect(inserted).toHaveLength(0);
  });
});
