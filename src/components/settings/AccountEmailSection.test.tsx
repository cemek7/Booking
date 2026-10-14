import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountEmailSection } from './AccountEmailSection';

jest.mock('@/lib/supabase/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'old@example.com' } }),
}));

describe('AccountEmailSection', () => {
  beforeEach(() => { global.fetch = jest.fn() as jest.Mock; });

  it('shows the verified email and rejects invalid or unchanged values', () => {
    render(<AccountEmailSection />);
    expect(screen.getByText(/old@example.com/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('New login email'), { target: { value: 'old@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change login email' }));
    expect(screen.getByRole('alert')).toHaveTextContent('different');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('explains that both inboxes must confirm', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    render(<AccountEmailSection />);
    fireEvent.change(screen.getByLabelText('New login email'), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change login email' }));
    expect(await screen.findByRole('status')).toHaveTextContent('both your current and new inboxes');
    await waitFor(() => expect(screen.getByLabelText('New login email')).toHaveValue(''));
  });
});
