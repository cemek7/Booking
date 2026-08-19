import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ApiResponse } from '@/lib/auth/auth-api-client';

const authGet = jest.fn<(url: string) => Promise<ApiResponse<unknown>>>();
const authPatch = jest.fn<(url: string, body?: unknown) => Promise<ApiResponse<unknown>>>();

jest.mock('@/lib/auth/auth-api-client', () => ({
  authGet: (...args: unknown[]) => authGet(...(args as [string])),
  authPatch: (...args: unknown[]) => authPatch(...(args as [string, unknown])),
}));

import EscalationBanner from '@/components/chat/EscalationBanner';

describe('EscalationBanner', () => {
  beforeEach(() => {
    authGet.mockReset();
    authPatch.mockReset();
    authPatch.mockResolvedValue({ status: 200, data: { success: true } });
  });

  it('shows pending escalations and claims one', async () => {
    authGet.mockResolvedValue({
      status: 200,
      data: {
        escalations: [{ id: 'e1', customer_phone: '234', reason: 'wants human' }],
      },
    });

    const onOpenCustomer = jest.fn<(customerPhone: string) => void>();
    const onClaimed = jest.fn<() => Promise<void>>();
    onClaimed.mockImplementation(async () => undefined);

    render(<EscalationBanner onOpenCustomer={onOpenCustomer} onClaimed={onClaimed} />);

    expect(await screen.findByText(/wants human/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /claim/i }));

    await waitFor(() =>
      expect(authPatch).toHaveBeenCalledWith('/api/escalation/e1', { action: 'claim' })
    );
    expect(onOpenCustomer).toHaveBeenCalledWith('234');
    expect(onClaimed).toHaveBeenCalled();
  });
});
