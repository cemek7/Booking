import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import type { ApiResponse } from '@/lib/auth/auth-api-client';

const authGet = jest.fn<(url: string) => Promise<ApiResponse<unknown>>>();

jest.mock('@/lib/auth/auth-api-client', () => ({
  authGet: (...args: unknown[]) => authGet(...(args as [string])),
}));

import ChatContextPanel from '@/components/chat/ChatContextPanel';

describe('ChatContextPanel', () => {
  beforeEach(() => {
    authGet.mockReset();
  });

  it('renders linked lead and retail order details for the active chat', async () => {
    authGet.mockImplementation(async (url: string) => {
      if (url === '/api/leads/lead-1') {
        return {
          status: 200,
          data: {
            data: {
              id: 'lead-1',
              name: 'Ada',
              phone: '+2348000000000',
              intent: 'bridal package',
              status: 'contacted',
              stage: 'quoted',
            },
          },
        };
      }

      return {
        status: 200,
        data: {
          data: {
            id: 'order-1',
            status: 'pending_payment',
            payment_status: 'pending',
            fulfillment_status: 'unfulfilled',
            currency: 'NGN',
            total_cents: 125000,
            metadata: {
              payment: {
                url: 'https://pay.example/order-1',
              },
            },
            items: [
              {
                id: 'item-1',
                quantity: 2,
                product: { name: 'Shampoo' },
                variant: { name: '500ml' },
              },
            ],
          },
        },
      };
    });

    render(
      <ChatContextPanel
        journeyType="retail"
        journeyStage="pending_payment"
        leadId="lead-1"
        orderId="order-1"
        cartItemCount={2}
        orderTotalCents={125000}
      />
    );

    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(screen.getByText(/bridal package/i)).toBeInTheDocument();
    expect(screen.getByText(/₦1,250/)).toBeInTheDocument();
    expect(screen.getByText(/Payment link ready:/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open orders workspace/i })).toBeInTheDocument();
  });
});
