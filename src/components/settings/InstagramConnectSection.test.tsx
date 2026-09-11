import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { InstagramConnectSection } from './InstagramConnectSection';

const authFetchMock = jest.fn();

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/lib/auth/auth-api-client', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

describe('InstagramConnectSection', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    authFetchMock.mockReturnValue(new Promise(() => undefined));
  });

  it('scopes the native OAuth navigation to the active tenant', () => {
    render(<InstagramConnectSection tenantId="tenant-123" />);

    expect(screen.getByRole('link', { name: 'Connect Instagram' })).toHaveAttribute(
      'href',
      '/api/auth/instagram/start?tenant_id=tenant-123',
    );
  });
});
