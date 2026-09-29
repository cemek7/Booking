import { describe, expect, it, jest } from '@jest/globals';
import { sendOutboundOnce, type OutboundDeliveryRow, type OutboundDeliveryStore } from './outboundDelivery';

function memoryStore(initial?: OutboundDeliveryRow): OutboundDeliveryStore {
  let row = initial;
  return {
    reserve: jest.fn<OutboundDeliveryStore['reserve']>(async (input) => {
      if (row) return { claimed: false, row };
      row = { ...input, id: 'message-1', deliveryStatus: 'pending', providerMessageId: null };
      return { claimed: true, row };
    }),
    restartFailed: jest.fn<OutboundDeliveryStore['restartFailed']>(async () => {
      if (row?.deliveryStatus !== 'failed') return false;
      row = { ...row, deliveryStatus: 'pending' };
      return true;
    }),
    update: jest.fn<OutboundDeliveryStore['update']>(async (input) => {
      row = { ...row!, deliveryStatus: input.deliveryStatus, providerMessageId: input.providerMessageId ?? null };
    }),
  };
}

const base = {
  tenantId: 'tenant-1',
  threadId: 'thread-1',
  idempotencyKey: 'batch-1:outbound:abc',
  channel: 'whatsapp' as const,
  from: 'booka',
  to: '2348000000000',
  content: 'Your booking is confirmed.',
};

describe('sendOutboundOnce', () => {
  it('persists pending intent before calling the provider and replays sent delivery', async () => {
    const events: string[] = [];
    const store = memoryStore();
    const originalReserve = store.reserve;
    store.reserve = jest.fn<OutboundDeliveryStore['reserve']>(async (input) => {
      events.push('persist');
      return originalReserve(input);
    });
    const send = jest.fn(async () => {
      events.push('send');
      return { success: true, messageId: 'provider-1' };
    });

    await expect(sendOutboundOnce({ ...base, send, store })).resolves.toMatchObject({ status: 'sent' });
    await expect(sendOutboundOnce({ ...base, send, store })).resolves.toMatchObject({ status: 'sent', replayed: true });

    expect(events.slice(0, 2)).toEqual(['persist', 'send']);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('marks an ambiguous provider exception delivery_unknown and never resends it', async () => {
    const store = memoryStore();
    const send = jest.fn(async () => { throw new Error('timeout after dispatch'); });

    await expect(sendOutboundOnce({ ...base, send, store })).resolves.toMatchObject({ status: 'delivery_unknown' });
    await expect(sendOutboundOnce({ ...base, send, store })).resolves.toMatchObject({ status: 'delivery_unknown', replayed: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('allows a definitively failed provider response to retry', async () => {
    const store = memoryStore({ ...base, id: 'message-1', deliveryStatus: 'failed', providerMessageId: null });
    const send = jest.fn(async () => ({ success: true, messageId: 'provider-2' }));

    await expect(sendOutboundOnce({ ...base, send, store })).resolves.toMatchObject({ status: 'sent' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not send when another attempt is pending', async () => {
    const store = memoryStore({ ...base, id: 'message-1', deliveryStatus: 'pending', providerMessageId: null });
    const send = jest.fn(async () => ({ success: true, messageId: 'unsafe' }));

    await expect(sendOutboundOnce({ ...base, send, store })).resolves.toMatchObject({ status: 'delivery_unknown', replayed: true });
    expect(send).not.toHaveBeenCalled();
  });

  it('records wallet exhaustion as a completed alternate handoff', async () => {
    const store = memoryStore();
    const send = jest.fn(async () => ({ success: false, reason: 'wallet_exhausted' }));

    await expect(sendOutboundOnce({ ...base, send, store })).resolves.toMatchObject({
      status: 'sent',
      reason: 'wallet_exhausted',
    });
    await expect(sendOutboundOnce({ ...base, send, store })).resolves.toMatchObject({
      status: 'sent',
      replayed: true,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('fails closed if an idempotency key resolves to different content', async () => {
    const store = memoryStore({
      ...base,
      id: 'message-1',
      content: 'Different message',
      deliveryStatus: 'sent',
      providerMessageId: 'provider-1',
    });
    const send = jest.fn(async () => ({ success: true, messageId: 'unsafe' }));

    await expect(sendOutboundOnce({ ...base, send, store })).rejects.toThrow('idempotency collision');
    expect(send).not.toHaveBeenCalled();
  });
});
