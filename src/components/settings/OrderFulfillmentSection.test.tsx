import { fireEvent, render, screen } from '@testing-library/react';
import { jest } from '@jest/globals';
import { OrderFulfillmentSection } from './OrderFulfillmentSection';

describe('OrderFulfillmentSection', () => {
  it('renders missing configuration safely and emits a complete policy', () => {
    const onChange = jest.fn();
    render(<OrderFulfillmentSection value={undefined} onChange={onChange} />);

    expect(screen.getByText('Not configured')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /^Customers pick up from us/ }));

    expect(onChange).toHaveBeenLastCalledWith({
      methods: ['customer_pickup'],
      thirdPartyProviders: [],
      serviceAreas: [],
      feePolicy: 'included',
    });
  });

  it('hydrates fixed fees from kobo without converting twice', () => {
    render(<OrderFulfillmentSection
      value={{
        methods: ['own_dispatch'],
        thirdPartyProviders: [],
        serviceAreas: ['Lekki'],
        feePolicy: 'fixed',
        fixedFeeCents: 250050,
      }}
      onChange={() => {}}
    />);

    expect(screen.getByLabelText('Fixed delivery fee (NGN)')).toHaveValue('2500.5');
    expect(screen.getByLabelText('Areas normally served (optional)')).toHaveValue('Lekki');
  });
});
