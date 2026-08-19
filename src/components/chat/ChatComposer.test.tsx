import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ChatComposer } from '@/components/chat/ChatComposer';

describe('ChatComposer', () => {
  const onSend = jest.fn<(text: string) => Promise<void>>();
  const onRelease = jest.fn<() => Promise<void>>();

  beforeEach(() => {
    onSend.mockReset();
    onRelease.mockReset();
  });

  it('sends a message and clears the textarea', async () => {
    onSend.mockImplementation(async () => undefined);
    render(<ChatComposer chatId="chat-1" onSend={onSend} />);

    fireEvent.change(screen.getByLabelText('Message composer'), { target: { value: 'Hello there' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Hello there'));
    await waitFor(() => expect(screen.getByLabelText('Message composer')).toHaveValue(''));
  });

  it('shows release controls when a human is handling the chat', async () => {
    onRelease.mockImplementation(async () => undefined);
    render(
      <ChatComposer
        chatId="chat-1"
        onSend={onSend}
        onRelease={onRelease}
        humanHandling
      />
    );

    expect(screen.getByText(/AI replies are paused/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Release to AI' }));

    await waitFor(() => expect(onRelease).toHaveBeenCalled());
  });

  it('shows outbound readiness guidance and blocks send when outbound is not allowed', async () => {
    render(
      <ChatComposer
        chatId="chat-1"
        onSend={onSend}
        outboundReadiness={{
          allowed: false,
          mode: 'blocked_consent_required',
          reason: 'WhatsApp follow-up outside the reply window requires explicit messaging consent.',
        }}
      />
    );

    expect(screen.getByText(/requires explicit messaging consent/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message composer'), { target: { value: 'Hello there' } });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});
