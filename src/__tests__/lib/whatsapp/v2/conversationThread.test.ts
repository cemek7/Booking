import {
  ensureActiveThread,
  isConversationStateConflict,
  transitionThread,
  updateThreadState,
  type ConversationThread,
  type ConversationThreadStore,
} from '@/lib/whatsapp/v2/conversationThread';
import { emptyConversationStructuredState } from '@/lib/whatsapp/v2/structuredState';

const baseThread: ConversationThread = {
  id: 'thread-1',
  tenantId: 'tenant-1',
  customerId: 'customer-1',
  channelIdentityId: 'identity-1',
  channel: 'whatsapp',
  status: 'active',
  structuredState: emptyConversationStructuredState(),
  stateVersion: 0,
  updatedAt: '2026-09-28T12:00:00.000Z',
};

function store(overrides: Partial<ConversationThreadStore> = {}): ConversationThreadStore {
  return {
    findUnfinishedThread: jest.fn().mockResolvedValue(null),
    createThread: jest.fn().mockResolvedValue(baseThread),
    attachConversation: jest.fn().mockResolvedValue(undefined),
    updateCanonicalState: jest.fn().mockResolvedValue(1),
    projectCompatibilityState: jest.fn().mockResolvedValue(undefined),
    transition: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('ensureActiveThread', () => {
  const input = {
    tenantId: 'tenant-1', customerId: 'customer-1', channelIdentityId: 'identity-1',
    channel: 'whatsapp' as const, conversationId: 'conversation-1',
  };

  it('reuses an unfinished thread for the exact tenant and channel identity', async () => {
    const threadStore = store({ findUnfinishedThread: jest.fn().mockResolvedValue(baseThread) });

    await expect(ensureActiveThread(input, threadStore)).resolves.toEqual(baseThread);
    expect(threadStore.createThread).not.toHaveBeenCalled();
    expect(threadStore.attachConversation).toHaveBeenCalledWith({
      tenantId: 'tenant-1', conversationId: 'conversation-1', threadId: 'thread-1', stateVersion: 0,
    });
  });

  it('creates a new thread instead of reopening a completed enquiry', async () => {
    const newThread = { ...baseThread, id: 'thread-2' };
    const threadStore = store({
      findUnfinishedThread: jest.fn().mockResolvedValue(null),
      createThread: jest.fn().mockResolvedValue(newThread),
    });

    await expect(ensureActiveThread(input, threadStore)).resolves.toEqual(newThread);
    expect(threadStore.createThread).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', channelIdentityId: 'identity-1',
    }));
  });
});

describe('versioned thread updates', () => {
  it('recognizes Supabase plain-object state conflict errors', () => {
    expect(isConversationStateConflict({
      code: 'P0001',
      message: 'conversation_state_version_conflict',
    })).toBe(true);
    expect(isConversationStateConflict({ code: 'P0001', message: 'another database error' })).toBe(false);
    expect(isConversationStateConflict(new Error('conversation_state_version_conflict'))).toBe(true);
  });

  it('uses the expected version and projects only after the canonical update succeeds', async () => {
    const threadStore = store();
    const state = {
      ...emptyConversationStructuredState(),
      intent: 'book_service',
      missing: ['time'],
    };

    await expect(updateThreadState({
      tenantId: 'tenant-1', threadId: 'thread-1', expectedVersion: 0, state,
    }, threadStore)).resolves.toEqual({ stateVersion: 1 });
    expect(threadStore.updateCanonicalState).toHaveBeenCalledWith({
      tenantId: 'tenant-1', threadId: 'thread-1', expectedVersion: 0, state,
    });
    expect(threadStore.projectCompatibilityState).toHaveBeenCalledWith({
      tenantId: 'tenant-1', threadId: 'thread-1', stateVersion: 1, state,
    });
  });

  it('keeps the compatibility projection disabled when rollout is off', async () => {
    const threadStore = store();
    await updateThreadState({
      tenantId: 'tenant-1', threadId: 'thread-1', expectedVersion: 0,
      state: emptyConversationStructuredState(), projectCompatibility: false,
    }, threadStore);
    expect(threadStore.updateCanonicalState).toHaveBeenCalled();
    expect(threadStore.projectCompatibilityState).not.toHaveBeenCalled();
  });

  it('does not overwrite newer state when the expected version is stale', async () => {
    const conflict = Object.assign(new Error('conversation_state_version_conflict'), { code: 'P0001' });
    const threadStore = store({ updateCanonicalState: jest.fn().mockRejectedValue(conflict) });

    await expect(updateThreadState({
      tenantId: 'tenant-1', threadId: 'thread-1', expectedVersion: 2,
      state: emptyConversationStructuredState(),
    }, threadStore)).rejects.toThrow('conversation_state_version_conflict');
    expect(threadStore.projectCompatibilityState).not.toHaveBeenCalled();
  });

  it('transitions only from the supplied statuses inside the tenant', async () => {
    const threadStore = store();
    await transitionThread({
      tenantId: 'tenant-1', threadId: 'thread-1', from: ['active', 'handed_off'], to: 'completed',
    }, threadStore);
    expect(threadStore.transition).toHaveBeenCalledWith({
      tenantId: 'tenant-1', threadId: 'thread-1', from: ['active', 'handed_off'], to: 'completed',
    });
  });
});
