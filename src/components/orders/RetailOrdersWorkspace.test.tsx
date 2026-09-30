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

  it('shows an unresolved delivery handoff and confirms its fee without exposing conflicting payment actions', async () => {
    authGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/retail/orders?')) {
        return {
          status: 200,
          data: { data: [{
            id: 'order-1', status: 'draft', payment_status: 'unpaid',
            fulfillment_status: 'unfulfilled', currency: 'NGN', total_cents: 56000,
            updated_at: '2026-07-04T10:00:00.000Z', customer: { name: 'Ada' },
          }] },
        };
      }
      return {
        status: 200,
        data: { data: {
          id: 'order-1', status: 'draft', payment_status: 'unpaid',
          fulfillment_status: 'unfulfilled', currency: 'NGN', total_cents: 56000,
          updated_at: '2026-07-04T10:00:00.000Z', customer: { name: 'Ada' },
          metadata: { retailFulfillment: {
            method: 'own_dispatch', provider: null,
            deliveryAddress: '12 Very Long Admiralty Delivery Address, Lekki Phase One',
            serviceArea: 'Lekki', feeStatus: 'quote_required', deliveryFeeCents: null,
            arrangementStatus: 'awaiting_human', conversationThreadId: null,
          } },
          items: [],
        } },
      };
    });

    render(<RetailOrdersWorkspace />);

    expect(await screen.findByText('Delivery needs your confirmation')).toBeInTheDocument();
    expect(screen.getByText(/12 Very Long Admiralty/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate payment link/i })).toBeDisabled();
    await waitFor(() => expect(screen.getByLabelText(/Fulfillment method/i)).toHaveValue('own_dispatch'));
    fireEvent.change(await screen.findByLabelText(/Final delivery fee/i), { target: { value: '2500' } });
    fireEvent.change(screen.getByLabelText(/Arrangement note/i), { target: { value: 'Rider will call' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm delivery and continue/i }));

    await waitFor(() => expect(authPost).toHaveBeenCalledWith(
      '/api/retail/orders/order-1/fulfillment',
      {
        method: 'own_dispatch', provider: null, deliveryFeeCents: 250000,
        note: 'Rider will call',
      },
    ));
  });

  it('retains operator input when fulfillment confirmation fails', async () => {
    authGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/retail/orders?')) {
        return { status: 200, data: { data: [{
          id: 'order-1', status: 'draft', payment_status: 'unpaid', fulfillment_status: 'unfulfilled',
          currency: 'NGN', total_cents: 56000, updated_at: '2026-07-04T10:00:00.000Z',
        }] } };
      }
      return { status: 200, data: { data: {
        id: 'order-1', status: 'draft', payment_status: 'unpaid', fulfillment_status: 'unfulfilled',
        currency: 'NGN', total_cents: 56000, updated_at: '2026-07-04T10:00:00.000Z',
        metadata: { retailFulfillment: {
          method: 'own_dispatch', provider: null, deliveryAddress: 'Lekki', serviceArea: null,
          feeStatus: 'quote_required', deliveryFeeCents: null, arrangementStatus: 'awaiting_human',
          conversationThreadId: null,
        } }, items: [],
      } } };
    });
    authPost.mockResolvedValue({ status: 409, error: { message: 'Could not save delivery' } as never });

    render(<RetailOrdersWorkspace />);
    const fee = await screen.findByLabelText(/Final delivery fee/i);
    fireEvent.change(fee, { target: { value: '1750' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm delivery and continue/i }));

    expect(await screen.findByText('Could not save delivery')).toBeInTheDocument();
    expect(fee).toHaveValue('1750');
  });
});
