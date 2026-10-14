import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AcceptInvitation from './AcceptInvitation';

const replace = jest.fn();
const signOut = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));
jest.mock('@/lib/supabase/client', () => ({
  getSupabaseBrowserClientAsync: async () => ({ auth: { signOut } }),
}));
jest.mock('@/components/AuthMagicLinkForm', () => function MockAuthMagicLinkForm(
  { redirectTo }: { redirectTo?: string }
) {
  return <div data-testid="magic-link-form" data-redirect-to={redirectTo}>Magic link form</div>;
});

const validStatus = {
  valid: true,
  tenant: { id: 'tenant-1', name: 'Northstar Clinic' },
  role: 'staff',
  masked_email: 'i***@example.com',
  expires_at: '2099-10-21T12:00:00.000Z',
  authenticated: false,
  email_matches: null,
};

function mockFetchStatus(status: Record<string, unknown>) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => status,
  }) as jest.Mock;
}

describe('AcceptInvitation', () => {
  beforeEach(() => {
    replace.mockReset();
    signOut.mockReset().mockResolvedValue({ error: null });
  });

  it('shows safe invite details and resumes sign-in', async () => {
    mockFetchStatus(validStatus);
    render(<AcceptInvitation />);

    expect(await screen.findByText('Northstar Clinic')).toBeInTheDocument();
    expect(screen.getByText(/staff/i)).toBeInTheDocument();
    expect(screen.getByText('i***@example.com')).toBeInTheDocument();
    expect(screen.getByTestId('magic-link-form')).toHaveAttribute('data-redirect-to', '/accept-invite');
    expect(document.body.textContent).not.toContain('invited@example.com');
  });

  it('shows one generic invalid state', async () => {
    mockFetchStatus({ valid: false });
    render(<AcceptInvitation />);
    expect(await screen.findByText('This invitation link is invalid or no longer available.')).toBeInTheDocument();
  });

  it('requires the invited account when signed-in email differs', async () => {
    mockFetchStatus({ ...validStatus, authenticated: true, email_matches: false });
    render(<AcceptInvitation />);

    expect(await screen.findByText(/different account/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).not.toBeInTheDocument();
  });

  it('accepts once and navigates only to the returned internal path', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...validStatus, authenticated: true, email_matches: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, redirect_to: '/dashboard/staff-dashboard' }),
      }) as jest.Mock;
    render(<AcceptInvitation />);

    const button = await screen.findByRole('button', { name: 'Accept invitation' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard/staff-dashboard'));
    expect(global.fetch).toHaveBeenLastCalledWith('/api/invitations/accept', expect.objectContaining({ method: 'POST' }));
  });
});
