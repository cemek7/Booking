import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ApiResponse } from '@/lib/auth/auth-api-client';

const authGet = jest.fn<(url: string) => Promise<ApiResponse<unknown>>>();
const authPost = jest.fn<(url: string, body?: unknown) => Promise<ApiResponse<unknown>>>();

jest.mock('@/lib/auth/auth-api-client', () => ({
  authGet: (...args: unknown[]) => authGet(...(args as [string])),
  authPost: (...args: unknown[]) => authPost(...(args as [string, unknown])),
}));

import MentionsFeed from '@/components/listening/MentionsFeed';

describe('MentionsFeed', () => {
  beforeEach(() => {
    authGet.mockReset();
    authPost.mockReset();
    authPost.mockResolvedValue({ status: 200, data: { success: true } });
  });

  it('loads new mentions and dismisses one', async () => {
    authGet.mockResolvedValue({
      status: 200,
      data: {
        mentions: [
          { id: 'm1', platform: 'twitter', content: 'love Glow', url: 'http://x', status: 'new' },
        ],
      },
    });

    render(<MentionsFeed />);

    expect(await screen.findByText(/love Glow/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    await waitFor(() => expect(authPost).toHaveBeenCalledWith('/api/listening/mentions/m1', { status: 'dismissed' }));
  });
});
