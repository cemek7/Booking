import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

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

jest.mock('@/lib/supabase/client', () => ({
  __esModule: true,
  getSupabaseBrowserClient: () => ({
    auth: {
      getUser: getUserMock,
      onAuthStateChange: onAuthStateChangeMock,
    },
  }),
}));

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

    render(<PostHogIdentity />);
    await Promise.resolve();

    expect(identifyMock).toHaveBeenCalledWith('user_123', { email: 'owner@example.com' });
    expect(resetMock).not.toHaveBeenCalled();
  });

  it('resets PostHog when no authenticated user is present', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
    });

    render(<PostHogIdentity />);
    await Promise.resolve();

    expect(resetMock).toHaveBeenCalledTimes(1);
    expect(identifyMock).not.toHaveBeenCalled();
  });
});
