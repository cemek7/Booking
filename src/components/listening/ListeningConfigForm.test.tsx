import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ApiResponse } from '@/lib/auth/auth-api-client';

const authGet = jest.fn<(url: string) => Promise<ApiResponse<unknown>>>();
const authPatch = jest.fn<(url: string, body?: unknown) => Promise<ApiResponse<unknown>>>();

jest.mock('@/lib/auth/auth-api-client', () => ({
  authGet: (...args: unknown[]) => authGet(...(args as [string])),
  authPatch: (...args: unknown[]) => authPatch(...(args as [string, unknown])),
}));

import ListeningConfigForm from '@/components/listening/ListeningConfigForm';

describe('ListeningConfigForm', () => {
  beforeEach(() => {
    authGet.mockReset();
    authPatch.mockReset();
  });

  it('loads config and saves updated values', async () => {
    authGet.mockResolvedValue({
      status: 200,
      data: {
        config: {
          businessName: 'Glow Salon',
          handles: ['@glow'],
          keywords: ['lagos'],
          platforms: ['instagram'],
          enabled: false,
          lastPolledAt: null,
        },
      },
    });
    authPatch.mockResolvedValue({
      status: 200,
      data: {
        config: {
          businessName: 'Glow Salon',
          handles: ['@glow', '@glowlagos'],
          keywords: ['lagos'],
          platforms: ['instagram', 'linkedin'],
          enabled: true,
          lastPolledAt: null,
        },
      },
    });

    render(<ListeningConfigForm />);

    expect(await screen.findByDisplayValue('Glow Salon')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('@glow'), { target: { value: '@glow, @glowlagos' } });
    fireEvent.click(screen.getByRole('button', { name: 'LinkedIn' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /save configuration/i }));

    await waitFor(() =>
      expect(authPatch).toHaveBeenCalledWith('/api/listening/config', {
        businessName: 'Glow Salon',
        handles: ['@glow', '@glowlagos'],
        keywords: ['lagos'],
        platforms: ['instagram', 'linkedin'],
        enabled: true,
      })
    );
  });
});
