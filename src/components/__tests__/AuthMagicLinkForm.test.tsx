/**
 * @jest-environment-options {"url":"https://staging.app.techclave.cloud/booka/auth/signin"}
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AuthMagicLinkForm from '@/components/AuthMagicLinkForm';

// Minimal inline supabase mock
jest.mock('@/lib/supabase/client', () => {
  const signInWithOtp = jest.fn().mockResolvedValue({ data: null, error: null });
  const mockAuth = {
    auth: {
      signInWithOtp,
      onAuthStateChange: jest.fn().mockReturnValue({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      signOut: jest.fn(),
    },
  };
  // handleSubmit awaits getSupabaseBrowserClientAsync(); without it the submit
  // throws before setMessage(), so the role="status" node never renders.
  return {
    getSupabaseBrowserClient: () => mockAuth,
    getSupabaseBrowserClientAsync: async () => mockAuth,
    getBrowserSupabase: () => mockAuth,
    default: mockAuth,
    supabase: mockAuth,
    __mockSignInWithOtp: signInWithOtp,
  };
})

function getMockSignInWithOtp(): jest.Mock {
  return jest.requireMock('@/lib/supabase/client').__mockSignInWithOtp;
}

describe('AuthMagicLinkForm', () => {
  beforeEach(() => {
    getMockSignInWithOtp().mockClear();
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.techclave.cloud';
    delete process.env.NEXT_PUBLIC_BASE_URL;
  });

  it('sends magic link when submitted', async () => {
    render(<AuthMagicLinkForm mode="signin" />);
    const input = screen.getByLabelText(/Email address/i);
    fireEvent.change(input, { target: { value: 'test@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  it('returns a staging sign-in to the staging callback even when the configured app URL is production', async () => {
    render(<AuthMagicLinkForm mode="signin" />);

    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }));

    await waitFor(() => {
      expect(getMockSignInWithOtp()).toHaveBeenCalledWith({
        email: 'owner@example.com',
        options: {
          emailRedirectTo:
            'https://staging.app.techclave.cloud/booka/auth/callback?finalize=1',
        },
      });
    });
  });

  it('preserves the safe invite continuation path', async () => {
    render(<AuthMagicLinkForm mode="signin" redirectTo="/accept-invite" />);

    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: 'invited@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }));

    await waitFor(() => {
      expect(getMockSignInWithOtp()).toHaveBeenCalledWith({
        email: 'invited@example.com',
        options: {
          emailRedirectTo:
            'https://staging.app.techclave.cloud/booka/auth/callback?finalize=1&next=%2Faccept-invite',
        },
      });
    });
  });
});
