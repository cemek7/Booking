import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { ApiResponse } from '@/lib/auth/auth-api-client';

const authGet = jest.fn<(url: string) => Promise<ApiResponse<unknown>>>();
const authPost = jest.fn<(url: string, body?: unknown) => Promise<ApiResponse<unknown>>>();
jest.mock('@/lib/auth/auth-api-client', () => ({
  authGet,
  authPost,
}));

import CustomerDsarControl from '@/components/dsar/CustomerDsarControl';

function typeCustomerId(id: string) {
  fireEvent.change(screen.getByLabelText(/customer id/i), { target: { value: id } });
}

describe('CustomerDsarControl', () => {
  beforeEach(() => {
    authGet.mockReset();
    authPost.mockReset();
  });

  it('calls the DSAR export endpoint for the entered customer', async () => {
    authGet.mockResolvedValue({ status: 200, data: { export: { customer: {} } } });
    render(<CustomerDsarControl tenantId="t1" />);
    typeCustomerId('c1');
    fireEvent.click(screen.getByRole('button', { name: /export data/i }));
    await waitFor(() =>
      expect(authGet).toHaveBeenCalledWith('/api/tenants/t1/customers/c1/dsar'),
    );
  });

  it('shows the dry-run erasure plan, then erases on confirm', async () => {
    authPost
      .mockResolvedValueOnce({ status: 200, data: { report: { actions: [{ table: 'messages', op: 'delete' }] } } })
      .mockResolvedValueOnce({ status: 200, data: { report: { actions: [] } } });
    render(<CustomerDsarControl tenantId="t1" />);
    typeCustomerId('c1');

    fireEvent.click(screen.getByRole('button', { name: /plan erasure/i }));
    await waitFor(() => expect(authPost).toHaveBeenCalledWith('/api/tenants/t1/customers/c1/dsar', {}));
    expect(await screen.findByText(/messages: delete/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirm erasure/i }));
    await waitFor(() =>
      expect(authPost).toHaveBeenCalledWith('/api/tenants/t1/customers/c1/dsar', { confirm: true }),
    );
  });

  it('disables actions until a customer id is entered', () => {
    render(<CustomerDsarControl tenantId="t1" />);
    expect(screen.getByRole('button', { name: /export data/i })).toBeDisabled();
  });
});
