import { describe, expect, it, jest } from '@jest/globals';
import {
  ConversationEffectBlockedError,
  runIdempotentEffect,
  type ConversationEffectRow,
  type ConversationEffectStore,
} from './conversationEffects';

function memoryStore(initial?: ConversationEffectRow): ConversationEffectStore {
  let row = initial;
  return {
    reserve: jest.fn<ConversationEffectStore['reserve']>(async (input) => {
      if (row) return { claimed: false, row };
      row = { ...input, status: 'started', resultRef: null, metadata: {} };
      return { claimed: true, row };
    }),
    restartFailed: jest.fn<ConversationEffectStore['restartFailed']>(async () => {
      if (row?.status !== 'failed') return false;
      row = { ...row, status: 'started' };
      return true;
    }),
    succeed: jest.fn<ConversationEffectStore['succeed']>(async (input) => {
      row = { ...row!, status: 'succeeded', resultRef: input.resultRef, metadata: input.metadata };
    }),
    fail: jest.fn<ConversationEffectStore['fail']>(async (input) => {
      row = { ...row!, status: 'failed', metadata: input.metadata };
    }),
    markUnknown: jest.fn<ConversationEffectStore['markUnknown']>(async (input) => {
      row = { ...row!, status: 'delivery_unknown', metadata: input.metadata };
    }),
  };
}

const base = {
  tenantId: 'tenant-1',
  threadId: 'thread-1',
  idempotencyKey: 'batch-1:create-booking:abc',
  effectType: 'create_booking',
};

describe('runIdempotentEffect', () => {
  it('executes once and replays the prior successful value', async () => {
    const store = memoryStore();
    const execute = jest.fn(async () => ({ id: 'booking-1' }));

    await expect(runIdempotentEffect({ ...base, execute, store })).resolves.toEqual({ id: 'booking-1' });
    await expect(runIdempotentEffect({ ...base, execute, store })).resolves.toEqual({ id: 'booking-1' });

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('allows a definitively failed effect to retry', async () => {
    const store = memoryStore({ ...base, status: 'failed', resultRef: null, metadata: {} });
    const execute = jest.fn(async () => 'recovered');

    await expect(runIdempotentEffect({ ...base, execute, store })).resolves.toBe('recovered');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.restartFailed).toHaveBeenCalledTimes(1);
  });

  it.each(['started', 'delivery_unknown'] as const)('never re-executes a %s effect', async (status) => {
    const store = memoryStore({ ...base, status, resultRef: null, metadata: {} });
    const execute = jest.fn(async () => 'unsafe duplicate');

    await expect(runIdempotentEffect({ ...base, execute, store })).rejects.toBeInstanceOf(ConversationEffectBlockedError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed when the action succeeds but recording success fails', async () => {
    const store = memoryStore();
    store.succeed = jest.fn(async () => { throw new Error('database timeout'); });
    const execute = jest.fn(async () => ({ id: 'booking-created' }));

    await expect(runIdempotentEffect({ ...base, execute, store })).rejects.toMatchObject({
      status: 'delivery_unknown',
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.markUnknown).toHaveBeenCalledTimes(1);
    expect(store.fail).not.toHaveBeenCalled();
  });
});
