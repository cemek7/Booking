/**
 * messageBatcher channel-awareness tests
 *
 * Verifies that claimBatch and appendPendingMessage key the whatsapp_conversations
 * table on (channel, external_id) rather than phone_number when a non-default
 * channel is supplied, and that the default (WhatsApp) path is unchanged.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ── Query-shape tracking ──────────────────────────────────────────────────────

type EqCall = [col: string, val: unknown];

interface SpyChain {
  select: jest.Mock;
  eq: jest.Mock;
  update: jest.Mock;
  maybeSingle: jest.Mock;
  eqCalls: EqCall[];
  _updatePayload: unknown;
}

/** Pending DB responses consumed by .maybeSingle() in order. */
const responses: Array<{ data: Record<string, unknown> | null; error: null }> = [];
function pushDb(data: Record<string, unknown> | null) {
  responses.push({ data, error: null });
}

/** All eq() call-pairs per chain, keyed by chain creation index. */
let chains: SpyChain[] = [];

function makeChain(): SpyChain {
  const eqCalls: EqCall[] = [];
  let _updatePayload: unknown;
  const chain = {} as SpyChain;
  chain.eqCalls = eqCalls;

  // Methods that return the chain for chaining
  (['select'] as const).forEach((m) => {
    (chain as unknown as Record<string, jest.Mock>)[m] = jest
      .fn()
      .mockReturnValue(chain);
  });

  chain.eq = jest.fn().mockImplementation((col: string, val: unknown) => {
    eqCalls.push([col, val]);
    return chain;
  });

  chain.update = jest.fn().mockImplementation((payload: unknown) => {
    _updatePayload = payload;
    chain._updatePayload = _updatePayload;
    return chain;
  });

  chain.maybeSingle = jest.fn().mockImplementation(() =>
    Promise.resolve(responses.shift() ?? { data: null, error: null })
  );

  chains.push(chain);
  return chain;
}

let fromCalls: string[] = [];

const mockClient = {
  from: jest.fn().mockImplementation((table: string) => {
    fromCalls.push(table);
    return makeChain();
  }),
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockClient),
}));

import { claimBatch, appendPendingMessage } from '@/lib/whatsapp/v2/messageBatcher';

beforeEach(() => {
  responses.length = 0;
  fromCalls = [];
  chains = [];
  mockClient.from.mockClear();
  mockClient.from.mockImplementation((table: string) => {
    fromCalls.push(table);
    return makeChain();
  });
});

// ─── claimBatch ───────────────────────────────────────────────────────────────

describe('claimBatch channel-awareness', () => {
  it('filters on channel=instagram + external_id when channel="instagram"', async () => {
    // Push a settled pending message (>2500ms ago)
    const oldTime = new Date(Date.now() - 5000).toISOString();
    pushDb({
      flow_data: {
        pending_messages: [
          { content: 'hello', receivedAt: oldTime, messageId: 'msg-ig-1' },
        ],
      },
    });
    // Push the update response (for clearing pending_messages)
    pushDb(null);

    await claimBatch('IGSID_42', 'tenant-1', 'instagram');

    // The SELECT chain (first from call) must have filtered on channel and external_id
    const selectChain = chains[0];
    expect(selectChain.eqCalls).toContainEqual(['channel', 'instagram']);
    expect(selectChain.eqCalls).toContainEqual(['external_id', 'IGSID_42']);
    // Must NOT filter on phone_number for Instagram
    expect(selectChain.eqCalls.map(([col]) => col)).not.toContain('phone_number');
  });

  it('UPDATE path uses channel=instagram + external_id (not phone_number) when channel="instagram"', async () => {
    const oldTime = new Date(Date.now() - 5000).toISOString();
    pushDb({
      flow_data: {
        pending_messages: [
          { content: 'claim me', receivedAt: oldTime, messageId: 'msg-ig-upd' },
        ],
      },
    });
    pushDb(null); // UPDATE response

    await claimBatch('IGSID_43', 'tenant-1', 'instagram');

    // chains[1] is the UPDATE chain (second .from() call)
    const updateChain = chains[1];
    expect(updateChain).toBeDefined();
    expect(updateChain.update).toHaveBeenCalledTimes(1);
    expect(updateChain.eqCalls).toContainEqual(['channel', 'instagram']);
    expect(updateChain.eqCalls).toContainEqual(['external_id', 'IGSID_43']);
    // Must NOT use phone_number on the UPDATE path
    expect(updateChain.eqCalls.map(([col]) => col)).not.toContain('phone_number');
  });

  it('filters on channel=whatsapp + external_id when no channel arg (default)', async () => {
    const oldTime = new Date(Date.now() - 5000).toISOString();
    pushDb({
      flow_data: {
        pending_messages: [
          { content: 'yo', receivedAt: oldTime, messageId: 'msg-wa-1' },
        ],
      },
    });
    pushDb(null);

    await claimBatch('+2348000000000', 'tenant-1');

    const selectChain = chains[0];
    expect(selectChain.eqCalls).toContainEqual(['channel', 'whatsapp']);
    expect(selectChain.eqCalls).toContainEqual(['external_id', '+2348000000000']);
  });

  it('UPDATE path uses channel=whatsapp + external_id (not phone_number) for default channel', async () => {
    const oldTime = new Date(Date.now() - 5000).toISOString();
    pushDb({
      flow_data: {
        pending_messages: [
          { content: 'claim me wa', receivedAt: oldTime, messageId: 'msg-wa-upd' },
        ],
      },
    });
    pushDb(null); // UPDATE response

    await claimBatch('+2348000000002', 'tenant-1');

    // chains[1] is the UPDATE chain
    const updateChain = chains[1];
    expect(updateChain).toBeDefined();
    expect(updateChain.update).toHaveBeenCalledTimes(1);
    expect(updateChain.eqCalls).toContainEqual(['channel', 'whatsapp']);
    expect(updateChain.eqCalls).toContainEqual(['external_id', '+2348000000002']);
    expect(updateChain.eqCalls.map(([col]) => col)).not.toContain('phone_number');
  });

  it('returns null (still arriving) and does not write when gap < 2500ms', async () => {
    const recentTime = new Date(Date.now() - 100).toISOString();
    pushDb({
      flow_data: {
        pending_messages: [
          { content: 'typing...', receivedAt: recentTime, messageId: 'msg-1' },
        ],
      },
    });

    const result = await claimBatch('IGSID_99', 'tenant-1', 'instagram');
    expect(result).toBeNull();
    // Only one from() call (the SELECT) — no UPDATE
    expect(fromCalls).toHaveLength(1);
  });

  it('returns null when no pending messages exist', async () => {
    pushDb({ flow_data: { pending_messages: [] } });
    const result = await claimBatch('IGSID_0', 'tenant-1', 'instagram');
    expect(result).toBeNull();
  });

  it('returns combined + messageIds when batch is settled', async () => {
    const oldTime = new Date(Date.now() - 5000).toISOString();
    pushDb({
      flow_data: {
        pending_messages: [
          { content: 'book me', receivedAt: oldTime, messageId: 'id-a' },
          { content: 'tomorrow', receivedAt: oldTime, messageId: 'id-b' },
        ],
      },
    });
    pushDb(null); // update response

    const result = await claimBatch('IGSID_42', 'tenant-1', 'instagram');
    expect(result).not.toBeNull();
    expect(result!.combined).toBe('book me tomorrow');
    expect(result!.messageIds).toEqual(['id-a', 'id-b']);
  });
});

// ─── appendPendingMessage ─────────────────────────────────────────────────────

describe('appendPendingMessage channel-awareness', () => {
  it('filters on channel=instagram + external_id in the SELECT when channel="instagram"', async () => {
    pushDb({ flow_data: { pending_messages: [] } }); // SELECT response
    pushDb(null); // UPDATE response

    await appendPendingMessage('IGSID_7', 'tenant-1', 'hi there', 'msg-99', 'instagram');

    const selectChain = chains[0];
    expect(selectChain.eqCalls).toContainEqual(['channel', 'instagram']);
    expect(selectChain.eqCalls).toContainEqual(['external_id', 'IGSID_7']);
    expect(selectChain.eqCalls.map(([col]) => col)).not.toContain('phone_number');
  });

  it('UPDATE path uses channel=instagram + external_id (not phone_number) when channel="instagram"', async () => {
    pushDb({ flow_data: { pending_messages: [] } }); // SELECT response
    pushDb(null); // UPDATE response

    await appendPendingMessage('IGSID_7', 'tenant-1', 'hi there', 'msg-99', 'instagram');

    // chains[1] is the UPDATE chain (second .from() call)
    const updateChain = chains[1];
    expect(updateChain).toBeDefined();
    expect(updateChain.update).toHaveBeenCalledTimes(1);
    expect(updateChain.eqCalls).toContainEqual(['channel', 'instagram']);
    expect(updateChain.eqCalls).toContainEqual(['external_id', 'IGSID_7']);
    // Must NOT use phone_number on the UPDATE path
    expect(updateChain.eqCalls.map(([col]) => col)).not.toContain('phone_number');
  });

  it('defaults to WhatsApp channel on the SELECT when no channel arg', async () => {
    pushDb({ flow_data: { pending_messages: [] } });
    pushDb(null);

    await appendPendingMessage('+2348000000001', 'tenant-2', 'book me', 'msg-100');

    const selectChain = chains[0];
    expect(selectChain.eqCalls).toContainEqual(['channel', 'whatsapp']);
    expect(selectChain.eqCalls).toContainEqual(['external_id', '+2348000000001']);
  });

  it('UPDATE path uses channel=whatsapp + external_id (not phone_number) for default channel', async () => {
    pushDb({ flow_data: { pending_messages: [] } });
    pushDb(null);

    await appendPendingMessage('+2348000000001', 'tenant-2', 'book me', 'msg-100');

    // chains[1] is the UPDATE chain
    const updateChain = chains[1];
    expect(updateChain).toBeDefined();
    expect(updateChain.update).toHaveBeenCalledTimes(1);
    expect(updateChain.eqCalls).toContainEqual(['channel', 'whatsapp']);
    expect(updateChain.eqCalls).toContainEqual(['external_id', '+2348000000001']);
    expect(updateChain.eqCalls.map(([col]) => col)).not.toContain('phone_number');
  });

  it('appends to existing pending_messages (does not overwrite them)', async () => {
    const existingTime = new Date(Date.now() - 1000).toISOString();
    pushDb({
      flow_data: {
        pending_messages: [
          { content: 'first', receivedAt: existingTime, messageId: 'id-first' },
        ],
      },
    });
    pushDb(null); // UPDATE response

    await appendPendingMessage('IGSID_8', 'tenant-1', 'second', 'id-second', 'instagram');

    // The update chain should have been called with 2 pending messages
    const updateChain = chains[1];
    expect(updateChain.update).toHaveBeenCalledTimes(1);
    const updateArg = updateChain.update.mock.calls[0][0] as {
      flow_data: { pending_messages: Array<{ messageId: string }> };
    };
    expect(updateArg.flow_data.pending_messages).toHaveLength(2);
    expect(updateArg.flow_data.pending_messages[0].messageId).toBe('id-first');
    expect(updateArg.flow_data.pending_messages[1].messageId).toBe('id-second');
  });
});
