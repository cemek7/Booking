import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import RetailFulfillmentFields, {
  EMPTY_RETAIL_FULFILLMENT_FORM,
  toRetailFulfillmentSettings,
  type RetailFulfillmentFormValue,
} from './RetailFulfillmentFields';

function Harness({ error }: { error?: string }) {
  const [value, setValue] = useState<RetailFulfillmentFormValue>(
    EMPTY_RETAIL_FULFILLMENT_FORM,
  );
  return (
    <>
      <RetailFulfillmentFields value={value} onChange={setValue} error={error} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

describe('RetailFulfillmentFields', () => {
  it('uses an accessible fieldset and reveals manual providers progressively', () => {
    render(<Harness />);

    expect(screen.getByRole('group', { name: 'Order fulfilment' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Bolt' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', {
      name: /^We arrange Bolt, inDrive or another local courier/,
    }));

    expect(screen.getByRole('checkbox', { name: 'Bolt' })).toBeInTheDocument();
    expect(screen.getAllByText(/manually arranged/i).length).toBeGreaterThan(0);
  });

  it('converts a fixed naira amount to integer kobo once', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('checkbox', { name: /^Our rider or dispatch team delivers/ }));
    fireEvent.change(screen.getByLabelText('How is the delivery fee determined?'), {
      target: { value: 'fixed' },
    });
    fireEvent.change(screen.getByLabelText('Fixed delivery fee (NGN)'), {
      target: { value: '2500.50' },
    });

    const formValue = JSON.parse(screen.getByTestId('value').textContent || '{}') as RetailFulfillmentFormValue;
    expect(toRetailFulfillmentSettings(formValue)).toEqual({
      success: true,
      data: {
        methods: ['own_dispatch'],
        thirdPartyProviders: [],
        serviceAreas: [],
        feePolicy: 'fixed',
        fixedFeeCents: 250050,
      },
    });
  });

  it('trims service areas and rejects invalid fixed amounts without losing the draft', () => {
    const value: RetailFulfillmentFormValue = {
      ...EMPTY_RETAIL_FULFILLMENT_FORM,
      methods: ['own_dispatch'],
      feePolicy: 'fixed',
      fixedFeeNaira: '-20',
      serviceAreas: ' Lekki,  Victoria Island , ',
    };

    expect(toRetailFulfillmentSettings(value)).toEqual({
      success: false,
      error: 'Enter a valid delivery fee of zero or more',
    });
    expect(value.fixedFeeNaira).toBe('-20');
  });

  it('announces a server error and preserves entered values', () => {
    render(<Harness error="Fulfilment settings could not be saved" />);

    fireEvent.change(screen.getByLabelText('Customer-facing note (optional)'), {
      target: { value: 'We confirm timing in chat.' },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Fulfilment settings could not be saved');
    expect(screen.getByLabelText('Customer-facing note (optional)')).toHaveValue(
      'We confirm timing in chat.',
    );
  });
});
