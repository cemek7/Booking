/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockToast = jest.fn();
const mockPush = jest.fn();
const mockCreate = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock('@/lib/publicBookingAPI', () => ({ publicBookingAPI: { createPublicBooking: (...a: unknown[]) => mockCreate(...a) } }));
jest.mock('@/app/book/[slug]/components/TenantHeader', () => ({ __esModule: true, default: () => null }));
jest.mock('@/app/book/[slug]/components/LoadingSpinner', () => ({ __esModule: true, default: () => null }));
jest.mock('@/app/book/[slug]/components/ServiceSelector', () => ({
  __esModule: true,
  default: ({ onSelect }: any) => <button onClick={() => onSelect('s1', 'Cut', 30, 10000)}>pick-service</button>,
}));
jest.mock('@/app/book/[slug]/components/DateTimePicker', () => ({
  __esModule: true,
  default: ({ onSelect }: any) => <button onClick={() => onSelect('2026-10-10', '10:00')}>pick-time</button>,
}));
jest.mock('@/app/book/[slug]/components/CustomerForm', () => ({
  __esModule: true,
  default: ({ onSubmit }: any) => <button onClick={() => onSubmit('Ada', 'a@x.co', '+2348000000000', undefined, false)}>submit-customer</button>,
}));
jest.mock('@/app/book/[slug]/components/BookingSummary', () => ({
  __esModule: true,
  default: ({ onConfirm }: any) => <button onClick={onConfirm}>confirm</button>,
}));

import BookingContainer from '@/app/book/[slug]/components/BookingContainer';

describe('BookingContainer deposit unavailable', () => {
  beforeEach(() => jest.clearAllMocks());

  it('tells the customer the business will contact them and does not confirm', async () => {
    mockCreate.mockResolvedValue({ id: 'r1', depositRequired: true, paymentUnavailable: true, paymentUrl: null });
    render(<BookingContainer slug="acme" tenantId="t1" />);
    fireEvent.click(screen.getByText('pick-service'));
    fireEvent.click(screen.getByText('pick-time'));
    fireEvent.click(screen.getByText('submit-customer'));
    fireEvent.click(screen.getByText('confirm'));

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    const calls = mockToast.mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0].description).toMatch(/business will contact you/i);
    expect(calls.some((c) => /Booking Confirmed/i.test(c.title))).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
