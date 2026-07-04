import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from '@jest/globals';
import { ChatSidebar } from '@/components/chat/ChatSidebar';

describe('ChatSidebar', () => {
  it('renders support status and assignee labels for chats', () => {
    render(
      <ChatSidebar
        chats={[
          {
            id: 'chat-1',
            subject: 'Ada Lovelace',
            channel: 'whatsapp',
            unread: 2,
            status: 'pending',
            assigneeLabel: 'Grace Hopper',
            journeyType: 'lead',
            journeyStage: 'qualified',
            lastMessageAt: '2026-07-03T09:15:00.000Z',
          },
        ]}
      />
    );

    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText('lead:qualified')).toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByLabelText('2 unread messages')).toBeInTheDocument();
  });
});
