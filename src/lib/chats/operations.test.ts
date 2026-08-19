import { describe, expect, it } from '@jest/globals';
import {
  getChatSupportState,
  mergeChatSupportState,
} from '@/lib/chats/operations';

describe('chat operations metadata helpers', () => {
  it('defaults support state for legacy chats', () => {
    expect(getChatSupportState(null)).toEqual({
      status: 'open',
      assigneeUserId: null,
      assigneeLabel: null,
    });
  });

  it('merges support state without dropping channel metadata', () => {
    const next = mergeChatSupportState(
      { subject: 'Customer', channel: 'instagram' },
      { status: 'pending', assigneeUserId: 'user-1', assigneeLabel: 'Ada' }
    );

    expect(next).toMatchObject({
      subject: 'Customer',
      channel: 'instagram',
      support: {
        status: 'pending',
        assigneeUserId: 'user-1',
        assigneeLabel: 'Ada',
      },
    });
  });
});
