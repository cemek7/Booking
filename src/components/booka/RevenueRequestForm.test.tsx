import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RevenueRequestForm from '@/components/booka/RevenueRequestForm';

const fetchMock = jest.fn<typeof fetch>();

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/business name/i), {
    target: { value: 'Ada Beauty Studio' },
  });
  fireEvent.change(screen.getByLabelText(/contact name/i), {
    target: { value: 'Ada Okafor' },
  });
  fireEvent.change(screen.getByLabelText(/^email/i), {
    target: { value: 'ada@example.com' },
  });
  fireEvent.change(screen.getByLabelText(/^phone/i), {
    target: { value: '+2348000000000' },
  });
  fireEvent.change(screen.getByLabelText(/weekly enquiries/i), {
    target: { value: '50_99' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: /whatsapp/i }));
  fireEvent.click(screen.getByRole('checkbox', { name: /consent to Booka contacting me/i }));
}

describe('RevenueRequestForm', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it('renders the revenue pilot action', () => {
    render(<RevenueRequestForm requestType="revenue_pilot" />);

    expect(screen.getByRole('button', { name: 'Apply for the Revenue Pilot' })).toBeInTheDocument();
  });

  it('requires consent before submitting', async () => {
    render(<RevenueRequestForm requestType="revenue_pilot" />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole('checkbox', { name: /consent to Booka contacting me/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Apply for the Revenue Pilot' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/consent to contact/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows other_vertical only when other is selected', () => {
    render(<RevenueRequestForm requestType="revenue_pilot" />);

    expect(screen.queryByLabelText(/describe your business type/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/business type/i), { target: { value: 'other' } });
    expect(screen.getByLabelText(/describe your business type/i)).toBeInTheDocument();
  });

  it('submits selected channels and normalized form fields', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'req_1', request_type: 'revenue_pilot', status: 'new' }),
    } as Response);
    render(<RevenueRequestForm requestType="revenue_pilot" />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole('checkbox', { name: /instagram/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Apply for the Revenue Pilot' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      request_type: 'revenue_pilot',
      business_name: 'Ada Beauty Studio',
      channels: ['whatsapp', 'instagram'],
      consent_to_contact: true,
    });
    expect(await screen.findByText(/application is in the review queue/i)).toBeInTheDocument();
  });

  it('displays a server error', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Request could not be saved' }),
    } as Response);
    render(<RevenueRequestForm requestType="revenue_pilot" />);
    fillRequiredFields();

    fireEvent.click(screen.getByRole('button', { name: 'Apply for the Revenue Pilot' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Request could not be saved');
  });

  it('disables submit while the request is pending', async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    render(<RevenueRequestForm requestType="revenue_pilot" />);
    fillRequiredFields();

    fireEvent.click(screen.getByRole('button', { name: 'Apply for the Revenue Pilot' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /submitting/i })).toBeDisabled());
    await act(async () => {
      resolveFetch?.({ ok: true, json: async () => ({ id: 'req_1' }) } as Response);
    });
    expect(await screen.findByText(/application is in the review queue/i)).toBeInTheDocument();
  });

  it('explains the privacy-safe next step for a missed revenue report', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'req_2', request_type: 'missed_revenue_report', status: 'new' }),
    } as Response);
    render(<RevenueRequestForm requestType="missed_revenue_report" />);
    fillRequiredFields();

    fireEvent.click(screen.getByRole('button', { name: 'Request the Missed Revenue Report' }));

    expect(await screen.findByText(/contact you to agree a consented, minimized sample/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /messages|conversation/i })).not.toBeInTheDocument();
  });
});
