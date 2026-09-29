import { describe, expect, it, jest } from '@jest/globals';
import { createHumanHandoff, type HumanHandoffStore } from '@/lib/whatsapp/v2/humanHandoff';
import {
  clearHumanHandling,
  isThreadHumanHandling,
  setHumanHandling,
  type HumanTakeoverStore,
} from '@/lib/whatsapp/v2/humanTakeover';

function takeoverStore(overrides: Partial<HumanTakeoverStore> = {}): HumanTakeoverStore {
  return {
    loadThread: jest.fn(async () => ({
      id: 'thread-1',
      status: 'active',
      humanHandlingUntil: null,
    })),
    updateThread: jest.fn(async () => undefined),
    projectCompatibility: jest.fn(async () => undefined),
    ...overrides,
  };
}

describe('canonical human-handoff continuity', () => {
  it('creates an escalation against the exact thread with a canonical snapshot', async () => {
    const insert = jest.fn(async (value) => ({ id: 'escalation-1', ...value }));
    const store: HumanHandoffStore = {
      loadCanonicalThread: jest.fn(async () => ({
        id: 'thread-1',
        status: 'active',
        state_version: 7,
        structured_state: { confirmed: { service: 'video consultation' }, proposed: {}, missing: [] },
        rolling_summary: 'Customer requested a video consultation.',
      })),
      findOpen: jest.fn(async () => null),
      insert,
    };

    await createHumanHandoff({
      tenantId: 'tenant-1',
      customerPhone: '+2348000000000',
      sessionId: 'conversation-1',
      threadId: 'thread-1',
      reason: 'customer requested human',
    }, store);

    expect(store.loadCanonicalThread).toHaveBeenCalledWith('tenant-1', 'thread-1');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 'tenant-1',
      conversation_thread_id: 'thread-1',
      conversation_snapshot: expect.objectContaining({
        conversation_thread_id: 'thread-1',
        state_version: 7,
        structured_state: expect.objectContaining({
          confirmed: { service: 'video consultation' },
        }),
      }),
    }));
  });

  it('uses the thread window as the authoritative AI pause', async () => {
    const store = takeoverStore({
      loadThread: jest.fn(async () => ({
        id: 'thread-1', status: 'handed_off', humanHandlingUntil: '2999-01-01T00:00:00.000Z',
      })),
    });

    await expect(isThreadHumanHandling({ tenantId: 'tenant-1', threadId: 'thread-1' }, store))
      .resolves.toBe(true);
  });

  it('projects takeover for compatibility without replacing canonical state', async () => {
    const store = takeoverStore();
    await setHumanHandling({
      tenantId: 'tenant-1', threadId: 'thread-1', externalId: '+2348', channel: 'whatsapp', minutes: 30,
    }, store);

    expect(store.updateThread).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', threadId: 'thread-1', status: 'handed_off',
      humanHandlingUntil: expect.any(String),
    }));
    expect(store.projectCompatibility).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread-1', humanHandlingUntil: expect.any(String),
    }));
  });

  it('releases the same thread without touching structured state or summary', async () => {
    const updateThread = jest.fn(async () => undefined);
    const store = takeoverStore({
      loadThread: jest.fn(async () => ({
        id: 'thread-1', status: 'handed_off', humanHandlingUntil: '2999-01-01T00:00:00.000Z',
      })),
      updateThread,
    });

    await clearHumanHandling({
      tenantId: 'tenant-1', threadId: 'thread-1', externalId: '+2348', channel: 'whatsapp',
    }, store);

    expect(updateThread).toHaveBeenCalledWith({
      tenantId: 'tenant-1', threadId: 'thread-1', status: 'active', humanHandlingUntil: null,
      fromStatuses: ['active', 'handed_off'],
    });
    expect(updateThread.mock.calls[0]?.[0]).not.toHaveProperty('structuredState');
    expect(updateThread.mock.calls[0]?.[0]).not.toHaveProperty('rollingSummary');
  });

  it('explicitly closes the thread instead of resetting it', async () => {
    const store = takeoverStore();
    await clearHumanHandling({
      tenantId: 'tenant-1', threadId: 'thread-1', externalId: '+2348', channel: 'whatsapp', close: true,
    }, store);
    expect(store.updateThread).toHaveBeenCalledWith(expect.objectContaining({ status: 'closed' }));
  });
});
