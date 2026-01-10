import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AuthMagicLinkForm from '@/components/AuthMagicLinkForm';

// Minimal inline supabase mock
jest.mock('@/lib/supabase/client', () => {
  const mockAuth = { auth: { signInWithOtp: jest.fn().mockResolvedValue({ data: null, error: null }), onAuthStateChange: jest.fn().mockReturnValue({ data: { subscription: { unsubscribe: () => {} } } }), signOut: jest.fn() } };
  return { getBrowserSupabase: () => mockAuth, default: mockAuth, supabase: mockAuth };
})

describe('AuthMagicLinkForm', () => {
  it('sends magic link when submitted', async () => {
    render(<AuthMagicLinkForm mode="signin" />);
    const input = screen.getByLabelText(/Email address/i);
    fireEvent.change(input, { target: { value: 'test@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });
});
