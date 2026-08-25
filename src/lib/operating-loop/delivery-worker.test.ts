import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

const captureServerAnalyticsEvent = jest.fn();

jest.mock('@/lib/analytics/server', () => ({ captureServerAnalyticsEvent }));
jest.mock('@/lib/analytics/events', () => ({
  ANALYTICS_EVENTS: {
    OPERATING_OBJECTIVE_DELIVERY_OUTCOME: 'operating_objective_delivery_outcome',
  },
}));

import { runOperatingDeliveryBatch, type OperatingDeliveryWorkerDependencies } from './delivery-worker';

const NOW = new Date('2026-08-24T12:00:00.000Z');

const delivery = {
  id: 'outbox-1', tenant_id: 'tenant-1', action_id: 'action-1', objective_id: 'objective-1',
  recipient: '2348012345678', idempotency_key: 'operating:tenant-1:objective-1', attempt_count: 1,
  payload: { actionType: 'confirm_booking' as const, content: 'Hi Ada, please confirm your 10am appointment.' },
};

function makeAdmin(rows = [delivery]) {
  const rpc = jest.fn((name: string, args: Record<string, unknown> = {}) => {
    if (name === 'claim_operating_deliveries') return Promise.resolve({ data: rows, error: null });
    if (name === 'complete_operating_delivery') return Promise.resolve({ data: [{ outbox_id: 'outbox-1', status: args.p_status }], error: null });
    return Promise.resolve({ data: null, error: null });
  });
  return { admin: { rpc } as unknown as SupabaseClient, rpc };
}

function workerDependencies(rows = [delivery]) {
  const { admin, rpc } = makeAdmin(rows);
  const sendTextMessage = jest.fn(async () => ({ success: true, messageId: 'provider-message-1' }));
  const governedSend = jest.fn(async (_admin: SupabaseClient, params: {
    sendFreeform: (text: string) => Promise<boolean>;
  }) => {
    const sent = await params.sendFreeform(delivery.payload.content);
    return sent ? { sent: true as const, mode: 'freeform' as const, reason: 'sent' as const } : { sent: false as const, reason: 'send_failed' as const };
  });

  const dependencies = {
      admin,
      getConversation: jest.fn(async () => ({ last_inbound_at: null, opted_out_at: null })),
      getProvider: jest.fn(async () => ({ sendTextMessage })),
      governedSend,
      brandText: jest.fn(async (_tenantId: string, _recipient: string, content: string) => `[Booka] ${content}`),
      now: () => NOW,
  };

  return {
    deps: dependencies as unknown as OperatingDeliveryWorkerDependencies,
    rpc,
    sendTextMessage,
    governedSend,
  };
}

function replaceDependency(
  deps: OperatingDeliveryWorkerDependencies,
  key: 'governedSend' | 'getProvider',
  value: unknown,
) {
  (deps as unknown as Record<string, unknown>)[key] = value;
}

describe('runOperatingDeliveryBatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    captureServerAnalyticsEvent.mockResolvedValue(undefined);
  });

  it('marks an approved delivery sent only after the governed sender successfully sends it', async () => {
    const { deps, rpc, sendTextMessage } = workerDependencies();

    await expect(runOperatingDeliveryBatch(deps)).resolves.toEqual({ claimed: 1, sent: 1, held: 0, failed: 0 });

    expect(sendTextMessage).toHaveBeenCalledWith('2348012345678', '[Booka] Hi Ada, please confirm your 10am appointment.');
    expect(rpc.mock.calls[rpc.mock.calls.length - 1]).toEqual(['complete_operating_delivery', {
      p_outbox_id: 'outbox-1', p_status: 'sent', p_provider_message_id: 'provider-message-1', p_error: null, p_available_at: null,
    }]);
    expect(captureServerAnalyticsEvent).toHaveBeenCalledWith({
      event: 'operating_objective_delivery_outcome',
      properties: {
        tenant_id: 'tenant-1',
        channel: 'whatsapp',
        flow: 'retention',
        metadata: { outcome: 'sent' },
      },
    });
  });

  it('holds an opt-out rather than marking its action completed or retrying it', async () => {
    const { deps, rpc } = workerDependencies();
    replaceDependency(deps, 'governedSend', jest.fn(async () => ({ sent: false, reason: 'opted_out' })));

    await expect(runOperatingDeliveryBatch(deps)).resolves.toEqual({ claimed: 1, sent: 0, held: 1, failed: 0 });

    expect(rpc.mock.calls[rpc.mock.calls.length - 1]).toEqual(['complete_operating_delivery', expect.objectContaining({
      p_outbox_id: 'outbox-1', p_status: 'held', p_error: 'opted_out',
    })]);
    expect(captureServerAnalyticsEvent).toHaveBeenCalledWith({
      event: 'operating_objective_delivery_outcome',
      properties: {
        tenant_id: 'tenant-1',
        channel: 'whatsapp',
        flow: 'retention',
        metadata: { outcome: 'held' },
      },
    });
  });

  it('holds a provider success without a message ID because delivery cannot be reconciled', async () => {
    const { deps, rpc } = workerDependencies();
    replaceDependency(deps, 'getProvider', jest.fn(async () => ({
      sendTextMessage: jest.fn(async () => ({ success: true })),
    })));

    await expect(runOperatingDeliveryBatch(deps)).resolves.toEqual({ claimed: 1, sent: 0, held: 1, failed: 0 });

    expect(rpc.mock.calls[rpc.mock.calls.length - 1]).toEqual(['complete_operating_delivery', expect.objectContaining({
      p_outbox_id: 'outbox-1', p_status: 'held', p_error: 'provider_message_id_missing',
    })]);
  });

  it('does not retry an ambiguous provider exception that may already have delivered the message', async () => {
    const { deps, rpc } = workerDependencies();
    replaceDependency(deps, 'governedSend', jest.fn(async (_admin: SupabaseClient, params: { sendFreeform: (text: string) => Promise<boolean> }) => {
      await params.sendFreeform(delivery.payload.content);
      throw new Error('provider connection dropped after submit');
    }));
    replaceDependency(deps, 'getProvider', jest.fn(async () => ({
      sendTextMessage: jest.fn(async () => { throw new Error('provider connection dropped after submit'); }),
    })));

    await expect(runOperatingDeliveryBatch(deps)).resolves.toEqual({ claimed: 1, sent: 0, held: 1, failed: 0 });

    expect(rpc.mock.calls[rpc.mock.calls.length - 1]).toEqual(['complete_operating_delivery', expect.objectContaining({
      p_outbox_id: 'outbox-1', p_status: 'held', p_error: 'ambiguous_provider_delivery',
    })]);
  });

  it('retries a missing provider with a future retry time rather than declaring success', async () => {
    const { deps, rpc } = workerDependencies();
    replaceDependency(deps, 'getProvider', jest.fn(async () => null));

    await expect(runOperatingDeliveryBatch(deps)).resolves.toEqual({ claimed: 1, sent: 0, held: 0, failed: 1 });

    expect(rpc.mock.calls[rpc.mock.calls.length - 1]).toEqual(['complete_operating_delivery', expect.objectContaining({
      p_status: 'retry', p_error: 'whatsapp_provider_unavailable', p_available_at: '2026-08-24T12:01:00.000Z',
    })]);
  });

  it('fails closed when the completion RPC does not confirm exactly one reconciled outbox row', async () => {
    const { deps, rpc } = workerDependencies();
    rpc.mockImplementation((name: string) => name === 'claim_operating_deliveries'
      ? Promise.resolve({ data: [delivery], error: null })
      : Promise.resolve({ data: [], error: null }));

    await expect(runOperatingDeliveryBatch(deps)).rejects.toThrow('operating delivery completion was not confirmed');
  });
});
