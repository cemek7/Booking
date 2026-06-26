import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { ApiResponse } from '@/lib/auth/auth-api-client';

const authGet = jest.fn<(url: string) => Promise<ApiResponse<unknown>>>();
const authPost = jest.fn<(url: string, body?: unknown) => Promise<ApiResponse<unknown>>>();
jest.mock('@/lib/auth/auth-api-client', () => ({
  authGet: (...a: unknown[]) => authGet(...a),
  authPost: (...a: unknown[]) => authPost(...a),
}));

import ReviewModerationQueue from '@/components/moderation/ReviewModerationQueue';

describe('ReviewModerationQueue', () => {
  beforeEach(() => {
    authGet.mockReset();
    authPost.mockReset();
    authPost.mockResolvedValue({ status: 200, data: { success: true } });
  });

  it('loads pending flags and renders them', async () => {
    authGet.mockResolvedValue({ status: 200, data: { flags: [{ id: 'f1', review_id: 'r1', reason: 'spam', status: 'pending' }] } });
    render(<ReviewModerationQueue />);
    expect(await screen.findByText(/Reason: spam/)).toBeInTheDocument();
    expect(authGet).toHaveBeenCalledWith('/api/moderation/reviews?status=pending');
  });

  it('takes down a review via the moderate endpoint', async () => {
    authGet.mockResolvedValue({ status: 200, data: { flags: [{ id: 'f1', review_id: 'r1', reason: 'spam', status: 'pending' }] } });
    render(<ReviewModerationQueue />);
    fireEvent.click(await screen.findByRole('button', { name: /take down review/i }));
    await waitFor(() => expect(authPost).toHaveBeenCalledWith('/api/reviews/r1/moderate', { action: 'hide' }));
  });

  it('dismisses a flag via the resolve endpoint', async () => {
    authGet.mockResolvedValue({ status: 200, data: { flags: [{ id: 'f1', review_id: 'r1', reason: 'spam', status: 'pending' }] } });
    render(<ReviewModerationQueue />);
    fireEvent.click(await screen.findByRole('button', { name: /dismiss/i }));
    await waitFor(() => expect(authPost).toHaveBeenCalledWith('/api/moderation/reviews/f1', { status: 'dismissed' }));
  });
});
