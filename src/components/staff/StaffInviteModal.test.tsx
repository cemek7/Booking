import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StaffInviteModal from './StaffInviteModal';

const toastSuccess = jest.fn();

jest.mock('@/components/ui/toast', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: jest.fn(),
  },
}));

jest.mock('@/lib/supabase/tenant-context', () => ({
  useTenant: () => ({ tenant: { id: 'tenant-1' }, role: 'owner' }),
}));

describe('StaffInviteModal', () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        email_sent: true,
        expires_at: '2026-10-21T12:00:00.000Z',
        url: '/should-never-be-rendered',
      }),
    } as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('confirms delivery without displaying an invitation URL', async () => {
    render(<StaffInviteModal open onClose={jest.fn()} />);

    fireEvent.change(screen.getByLabelText('Staff email'), {
      target: { value: 'staff@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Invite' }));

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Invitation sent to staff@example.com');
    });
    expect(JSON.stringify(toastSuccess.mock.calls)).not.toContain('/should-never-be-rendered');
  });
});
