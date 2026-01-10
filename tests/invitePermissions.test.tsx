// Jest globals are available without import
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import StaffInvitePage from '@/app/dashboard/staff/invite/page';

// Mock Sidebar (avoid unrelated fetch/logic)
jest.mock('@/components/ui/sidebar', () => () => null);

// Control useTenant
const mockUseTenant = jest.fn();
jest.mock('@/lib/supabase/tenant-context', () => ({ useTenant: () => mockUseTenant() }));

describe('Invite permissions on StaffInvitePage', () => {
  const origFetch: typeof global.fetch = global.fetch;
  beforeEach(() => {
    jest.resetModules();
    mockUseTenant.mockReturnValue({ tenant: { id: 't1' }, role: 'manager' });
    // Overwrite fetch with mock
    global.fetch = jest.fn() as unknown as typeof global.fetch;
  });
  afterEach(() => { global.fetch = origFetch; });

  it('enables form when allowed', async () => {
    // settings fetch returns allowed inviter roles and allow from staff page
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ allowedInviterRoles: ['manager'], allowInvitesFromStaffPage: true }) });
    render(<StaffInvitePage />);
    // wait for permission check to settle
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const button = await screen.findByText('Send Invite');
    expect((button as HTMLButtonElement).hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(/don't have permission/i)).toBeNull();
  });

  it('disables form and shows notice when disallowed', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ allowedInviterRoles: ['owner'], allowInvitesFromStaffPage: false }) });
    render(<StaffInvitePage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const notice = await screen.findByText(/don't have permission/i);
    expect(notice).toBeTruthy();
    const button = screen.getByText('Send Invite') as HTMLButtonElement;
    expect(button.getAttribute('disabled')).toBe('');
  });
});
