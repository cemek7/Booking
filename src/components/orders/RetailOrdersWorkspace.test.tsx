import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ApiResponse } from '@/lib/auth/auth-api-client';

const authGet = jest.fn<(url: string) => Promise<ApiResponse<unknown>>>();
const authPatch = jest.fn<(url: string, body?: unknown) => Promise<ApiResponse<unknown>>>();
const authPost = jest.fn<(url: string, body?: unknown) => Promise<ApiResponse<unknown>>>();

jest.mock('@/lib/auth/auth-api-client', () => ({
  authGet: (...args: unknown[]) => authGet(...(args as [string])),
  authPatch: (...args: unknown[]) => authPatch(...(args as [string, unknown])),
  authPost: (...args: unknown[]) => authPost(...(args as [string, unknown])),
}));

import RetailOrdersWorkspace from '@/components/orders/RetailOrdersWorkspace';

describe('RetailOrdersWorkspace', () => {
  beforeEach(() => {
    authGet.mockReset();
    authPatch.mockReset();
    authPost.mockReset();

    authGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/retail/orders?')) {
        return {
          status: 200,
          data: {
            data: [
              {
                id: 'order-1',
                status: 'draft',
                payment_status: 'unpaid',
                fulfillment_status: 'unfulfilled',
                currency: 'NGN',
                total_cents: 56000,
                updated_at: '2026-07-04T10:00:00.000Z',
                customer: { name: 'Ada' },
              },
            ],
          },
        };
      }

      return {
        status: 200,
        data: {
          data: {
            id: 'order-1',
            status: 'draft',
            payment_status: 'unpaid',
            fulfillment_status: 'unfulfilled',
            currency: 'NGN',
            total_cents: 56000,
            updated_at: '2026-07-04T10:00:00.000Z',
            customer: { name: 'Ada', phone: '+2348000000000' },
            items: [
              {
                id: 'item-1',
                quantity: 1,
                total_price_cents: 56000,
                product: { name: 'Hair mask' },
              },
            ],
          },
        },
      };
    });

    authPost.mockResolvedValue({
      status: 200,
      data: {
        data: {
          paymentUrl: 'https://pay.example/order-1',
        },
      },
    });
  });

  it('loads orders and generates a payment link for the selected draft order', async () => {
    render(<RetailOrdersWorkspace />);

    expect(await screen.findByText('Ada')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Generate payment link/i }));

    await waitFor(() =>
      expect(authPost).toHaveBeenCalledWith('/api/retail/orders/order-1/payment-link')
    );
  });
});
