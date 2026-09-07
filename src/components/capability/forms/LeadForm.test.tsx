import { describe, it, expect } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeadForm } from './LeadForm';

describe('LeadForm', () => {
  it('shows a validation error on empty required submit and no success', async () => {
    render(<LeadForm fields={[{ name: 'name', label: 'Name', required: true }]} submitLabel="Request assessment" />);
    await userEvent.click(screen.getByRole('button', { name: /request assessment/i }));
    expect(screen.getByText(/required/i)).toBeTruthy();
    expect(screen.queryByText(/thank you/i)).toBeNull();
  });
  it('shows success on valid local mock submit (no network)', async () => {
    render(<LeadForm fields={[{ name: 'name', label: 'Name', required: true }]} submitLabel="Request assessment" />);
    await userEvent.type(screen.getByLabelText(/name/i), 'Ada');
    await userEvent.click(screen.getByRole('button', { name: /request assessment/i }));
    expect(await screen.findByText(/thank you/i)).toBeTruthy();
  });
});
