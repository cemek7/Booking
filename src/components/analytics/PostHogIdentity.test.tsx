import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AnalyticsReadyProvider } from '@/components/analytics/AnalyticsReadyContext';

const identifyMock = jest.fn();
const resetMock = jest.fn();
const getUserMock = jest.fn();
const onAuthStateChangeMock = jest.fn();

jest.mock('posthog-js', () => ({
  __esModule: true,
  default: {
    identify: identifyMock,
    reset: resetMock,
  },
}));

jest.mock('@/lib/supabase/client', () => {
  const client = {
    auth: {
      getUser: getUserMock,
      onAuthStateChange: onAuthStateChangeMock,
    },
  };
  return {
    __esModule: true,
    getSupabaseBrowserClient: () => client,
    // PostHogIdentity calls the async variant; without it the component throws
    // "getSupabaseBrowserClientAsync is not a function" and never identifies.
    getSupabaseBrowserClientAsync: async () => client,
  };
});

import PostHogIdentity from '@/components/analytics/PostHogIdentity';

describe('PostHogIdentity', () => {
  beforeEach(() => {
    identifyMock.mockClear();
    resetMock.mockClear();
    getUserMock.mockReset();
    onAuthStateChangeMock.mockReset();
    onAuthStateChangeMock.mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    });
  });

  it('identifies the current authenticated user', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'user_123', email: 'owner@example.com' } },
    });

    render(
      <AnalyticsReadyProvider ready>
        <PostHogIdentity />
      </AnalyticsReadyProvider>,
    );
    // The component resolves the client, then getUser() — two chained
    // microtask ticks — so a single `await Promise.resolve()` lands too early.
    await waitFor(() =>
      expect(identifyMock).toHaveBeenCalledWith('user_123', { email: 'owner@example.com' }),
    );
    expect(resetMock).not.toHaveBeenCalled();
  });

  it('resets PostHog when no authenticated user is present', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
    });

    render(
      <AnalyticsReadyProvider ready>
        <PostHogIdentity />
      </AnalyticsReadyProvider>,
    );
    await waitFor(() => expect(resetMock).toHaveBeenCalledTimes(1));
    expect(identifyMock).not.toHaveBeenCalled();
  });
});
