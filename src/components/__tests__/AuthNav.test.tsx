import React from 'react';
import { render, screen } from '@testing-library/react';
import AuthNav from '@/components/AuthNav';

jest.mock('@/lib/supabase/client', () => {
  const mockAuth = { auth: { getSession: jest.fn().mockResolvedValue({ data: { session: null } }), onAuthStateChange: jest.fn().mockReturnValue({ data: { subscription: { unsubscribe: () => {} } } }) } };
  return { getBrowserSupabase: () => mockAuth, default: mockAuth, supabase: mockAuth };
})

describe('AuthNav', () => {
  it('renders sign in when not authenticated', async () => {
    render(<AuthNav />);
    expect(await screen.findByText(/Sign in/i)).toBeInTheDocument();
  });
});
