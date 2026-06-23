import {
  allocationFor,
  evaluateSend,
  hashRecipient,
  recordSend,
} from '@/lib/whatsapp/v2/deliverability/sendGovernor';

const responses: Array<unknown> = [];
const updates: Array<Record<string, unknown>> = [];

function pushDb(value: unknown) {
  responses.push(value);
}

function makeChain() {
  const chain: Record<string, jest.Mock> = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => ({ data: responses.shift() ?? null, error: null })),
    upsert: jest.fn(async (payload: Record<string, unknown>) => {
      updates.push(payload);
      return { error: null };
    }),
  };

  return chain;
}

const from = jest.fn(() => makeChain());
const admin = { from };

describe('evaluateSend', () => {
  beforeEach(() => {
    responses.length = 0;
    updates.length = 0;
    from.mockClear();
  });

  it('blocks while quarantined', async () => {
    pushDb({
      tenant_id: 't1',
      quarantined_until: new Date(Date.now() + 3600e3).toISOString(),
      initiated_recipients_24h: 0,
      recipients_seen: [],
      window_start: new Date().toISOString(),
      sent_24h: 0,
      initiated_24h: 0,
      cold_outbound_24h: 0,
      opt_outs_24h: 0,
      failures_24h: 0,
      risk_score: 0,
    });

    const decision = await evaluateSend(
      admin as never,
      't1',
      { phoneNumberId: 'P', quality: 'GREEN', limitPer24h: 1000 },
      'cust1',
    );

    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe('quarantined');
  });

  it('allows a repeat recipient even at allocation', async () => {
    pushDb({
      tenant_id: 't1',
      quarantined_until: null,
      initiated_recipients_24h: 50,
      recipients_seen: [hashRecipient('cust1')],
      risk_score: 0,
      window_start: new Date().toISOString(),
      sent_24h: 0,
      initiated_24h: 0,
      cold_outbound_24h: 0,
      opt_outs_24h: 0,
      failures_24h: 0,
    });

    const decision = await evaluateSend(
      admin as never,
      't1',
      { phoneNumberId: 'P', quality: 'GREEN', limitPer24h: 1000 },
      'cust1',
    );

    expect(allocationFor({ phoneNumberId: 'P', quality: 'GREEN', limitPer24h: 1000 })).toBe(50);
    expect(decision.allow).toBe(true);
  });

  it('blocks a new recipient once allocation is hit', async () => {
    pushDb({
      tenant_id: 't1',
      quarantined_until: null,
      initiated_recipients_24h: 50,
      recipients_seen: [hashRecipient('other')],
      risk_score: 0,
      window_start: new Date().toISOString(),
      sent_24h: 0,
      initiated_24h: 0,
      cold_outbound_24h: 0,
      opt_outs_24h: 0,
      failures_24h: 0,
    });

    const decision = await evaluateSend(
      admin as never,
      't1',
      { phoneNumberId: 'P', quality: 'GREEN', limitPer24h: 1000 },
      'cust1',
    );

    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe('allocation_exhausted');
  });
});

describe('recordSend', () => {
  beforeEach(() => {
    responses.length = 0;
    updates.length = 0;
    from.mockClear();
  });

  it('increments a new initiated recipient and stores its hash', async () => {
    pushDb({
      tenant_id: 't1',
      window_start: new Date().toISOString(),
      sent_24h: 2,
      initiated_24h: 1,
      initiated_recipients_24h: 1,
      recipients_seen: [],
      cold_outbound_24h: 0,
      opt_outs_24h: 0,
      failures_24h: 0,
      risk_score: 0,
      quarantined_until: null,
    });

    await recordSend(admin as never, 't1', {
      recipient: 'cust1',
      initiated: true,
      cold: true,
      failed: false,
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      tenant_id: 't1',
      sent_24h: 3,
      initiated_24h: 2,
      initiated_recipients_24h: 2,
      cold_outbound_24h: 1,
      failures_24h: 0,
    });
    expect((updates[0].recipients_seen as string[])[0]).toBe(hashRecipient('cust1'));
  });
});
