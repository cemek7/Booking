import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockUseChatRealtime = jest.fn();
jest.mock('@/hooks/useChatRealtime', () => ({
  useChatRealtime: (...args: unknown[]) => mockUseChatRealtime(...args),
}));
jest.mock('@/lib/supabase/tenant-context', () => ({
  useTenant: () => ({ tenant: { id: 'tenant-1' } }),
}));
jest.mock('@/components/chat/EscalationBanner', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/chat/ChatContextPanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/chat/ChatThread', () => ({
  ChatThread: () => <div>Thread</div>,
}));

import ChatsPanel from '@/components/chat/ChatsPanel';

function hookValue(chat: Record<string, unknown>) {
  return {
    chats: [{
      id: 'chat-1',
      subject: 'Ada',
      customerPhone: '+2348000000000',
      channel: 'whatsapp',
      status: 'open',
      journeyType: 'retail',
      unread: 0,
      ...chat,
    }],
    activeId: 'chat-1',
    setActiveId: jest.fn(),
    messages: [],
    send: jest.fn(),
    release: jest.fn(async () => undefined),
    claim: jest.fn(),
    assign: jest.fn(),
    unassign: jest.fn(),
    updateStatus: jest.fn(),
    loading: false,
    reloadChats: jest.fn(),
    outboundReadiness: null,
    assignees: [],
  };
}

describe('ChatsPanel fulfillment handoff', () => {
  beforeEach(() => {
    mockUseChatRealtime.mockReset();
  });

  it('treats until-released as active without a timestamp and exposes the unresolved handoff on mobile', async () => {
    const value = hookValue({
      humanHandlingMode: 'until_released',
      humanHandlingUntil: null,
      journeyStage: 'awaiting_fulfillment_handoff',
      retailFulfillment: {
        method: 'third_party_manual',
        provider: 'bolt',
        feeStatus: 'quote_required',
        arrangementStatus: 'awaiting_human',
      },
    });
    mockUseChatRealtime.mockReturnValue(value);

    render(<ChatsPanel />);

    expect(screen.getByText(/AI replies are paused until you release it/i)).toBeInTheDocument();
    expect(screen.getByText(/Delivery needs a teammate/i)).toBeInTheDocument();
    expect(screen.getByText(/Bolt delivery/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Release to AI' }));
    await waitFor(() => expect(value.release).toHaveBeenCalledTimes(1));
  });

  it('does not keep an expired timed hold active and tolerates missing fulfillment context', () => {
    mockUseChatRealtime.mockReturnValue(hookValue({
      humanHandlingMode: 'timed',
      humanHandlingUntil: '2020-01-01T00:00:00.000Z',
      retailFulfillment: null,
    }));

    render(<ChatsPanel />);

    expect(screen.queryByRole('button', { name: 'Release to AI' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Delivery needs a teammate/i)).not.toBeInTheDocument();
  });
});
