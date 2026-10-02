import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/components/ui/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

import PaymentSettingsSection from '@/components/settings/PaymentSettingsSection';

const policy = { code: 'pilot_ngn_v1', version: 1, basisPoints: 100, capMinor: 200000 };
const example = { amountMinor: 1000000, platformFeeMinor: 10000, tenantGrossMinor: 990000 };
const banks = [{ name: 'GTBank', code: '058', slug: 'gtbank' }];

function mockApi(sub: Record<string, unknown>) {
  const fetchMock = jest.fn((url: string, init?: RequestInit) => {
    if (url === '/api/payments/banks') return Promise.resolve({ ok: true, json: async () => ({ banks }) });
    if (url === '/api/payments/subaccounts' && init?.method) {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, status: 'active', account: { bankCode: '058', accountLast4: '6789', accountName: 'ACME' } }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ policy, example, ...sub }) });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => jest.clearAllMocks());

describe('PaymentSettingsSection', () => {
  it('discloses both fees and the setup-needed state', async () => {
    mockApi({ configured: false, status: null, account: null });
    render(<PaymentSettingsSection tenantId="ten_1" />);
    await waitFor(() => expect(screen.getByTestId('settlement-status')).toBeInTheDocument());
    expect(screen.getByTestId('settlement-status')).toHaveTextContent('Setup needed');
    expect(screen.getByTestId('booka-fee')).toHaveTextContent('Booka fee: 1% per payment, capped at ₦2,000');
    expect(screen.getByTestId('paystack-fee-note')).toHaveTextContent("Paystack's processing fee is deducted from your payout.");
    expect(screen.getByTestId('settlement-example')).toHaveTextContent(
      "On a ₦10,000 payment: Booka fee ₦100, you receive ₦9,900 before Paystack's fee."
    );
    expect(screen.getByTestId('collection-disabled-warning')).toHaveTextContent(
      "You can't collect customer payments until setup is active."
    );
  });

  it('shows the masked account and no warning when active', async () => {
    mockApi({ configured: true, status: 'active', account: { bankCode: '058', accountLast4: '1234', accountName: 'ACME' } });
    render(<PaymentSettingsSection tenantId="ten_1" />);
    await waitFor(() => expect(screen.getByTestId('settlement-status')).toHaveTextContent('Active'));
    expect(screen.getByText(/\*\*\*\*1234/)).toBeInTheDocument();
    expect(screen.queryByTestId('collection-disabled-warning')).toBeNull();
    expect(screen.queryByText(/Percentage going to you/)).toBeNull();
  });

  it.each([['pending', 'Pending verification'], ['invalid', 'Needs attention'], ['suspended', 'Needs attention']])(
    'maps status %s to "%s"', async (status, label) => {
      mockApi({ configured: false, status, account: { bankCode: '058', accountLast4: '1234', accountName: 'ACME' } });
      render(<PaymentSettingsSection tenantId="ten_1" />);
      await waitFor(() => expect(screen.getByTestId('settlement-status')).toHaveTextContent(label));
      expect(screen.getByTestId('collection-disabled-warning')).toBeInTheDocument();
    });

  it('keeps Save disabled until the policy is accepted, then sends acceptPolicy', async () => {
    const fetchMock = mockApi({ configured: false, status: null, account: null });
    render(<PaymentSettingsSection tenantId="ten_1" />);
    await waitFor(() => expect(screen.getByTestId('accept-policy')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('option', { name: 'GTBank' })).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByRole('combobox'), '058');
    await userEvent.type(screen.getByPlaceholderText('0123456789'), '0123456789');
    await userEvent.type(screen.getByPlaceholderText('Your business name'), 'Acme');
    await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'o@test.com');

    const save = screen.getByRole('button', { name: /save payment details/i });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByTestId('accept-policy'));
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
      expect(call).toBeDefined();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.acceptPolicy).toEqual({ code: 'pilot_ngn_v1', version: 1 });
      expect(body.settlementBank).toBe('058');
    });
    await waitFor(() => expect(screen.getByTestId('settlement-status')).toHaveTextContent('Active'));
    expect(screen.getByText(/\*\*\*\*6789/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('0123456789')).toBeNull();
  });
});
