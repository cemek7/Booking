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

  it('links a fulfillment handoff to its order without opening a fake chat', async () => {
    authGet.mockResolvedValue({
      status: 200,
      data: {
        escalations: [{
          id: 'e-order',
          customer_phone: 'retail-order:order-1',
          reason: 'Delivery arrangement needs a teammate',
          reason_code: 'retail_fulfillment',
          retail_order_id: 'order-1',
        }],
      },
    });
    const onOpenCustomer = jest.fn<(customerPhone: string) => void>();

    render(<EscalationBanner onOpenCustomer={onOpenCustomer} />);

    expect(await screen.findByText('Delivery needs attention')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open order/i })).toHaveAttribute(
      'href',
      '/dashboard/orders?order=order-1',
    );
    fireEvent.click(screen.getByRole('button', { name: /claim/i }));
    await waitFor(() => expect(authPatch).toHaveBeenCalled());
    expect(onOpenCustomer).not.toHaveBeenCalled();
  });
});
