import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import SettingsWorkspace from './SettingsWorkspace';

const replaceMock = jest.fn();
const pushMock = jest.fn();
const mutateMock = jest.fn();
let mockSearch = 'tab=tenant&instagram=connected';
let mockQueryData: Record<string, unknown> = {};

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

jest.mock('@/lib/supabase/tenant-context', () => ({
  useTenant: () => ({ tenant: { id: 'tenant-123' } }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mockQueryData, isLoading: false }),
  useMutation: () => ({ mutate: mutateMock, isPending: false }),
  useQueryClient: () => ({
    cancelQueries: jest.fn(),
    getQueryData: jest.fn(),
    setQueryData: jest.fn(),
    invalidateQueries: jest.fn(),
  }),
}));

jest.mock('@/components/settings/TenantProfileSection', () => ({
  TenantProfileSection: () => <div>Tenant profile content</div>,
}));
jest.mock('@/components/settings/BusinessProfileSection', () => ({ BusinessProfileSection: () => null }));
jest.mock('@/components/settings/NotificationPreferencesSection', () => ({ NotificationPreferencesSection: () => null }));
jest.mock('@/components/settings/SecuritySettingsSection', () => ({ SecuritySettingsSection: () => null }));
jest.mock('@/components/settings/WhatsAppSyncSection', () => ({ WhatsAppSyncSection: () => null }));
jest.mock('@/components/settings/MetaWhatsAppConnectSection', () => ({ MetaWhatsAppConnectSection: () => null }));
jest.mock('@/components/settings/InstagramConnectSection', () => ({ InstagramConnectSection: () => null }));
jest.mock('@/components/settings/PaymentSettingsSection', () => ({ PaymentSettingsSection: () => null }));
jest.mock('@/components/settings/AgentConfigSection', () => ({
  AgentConfigSection: ({ onChange }: { onChange: (patch: Record<string, unknown>) => void }) => (
    <button
      type="button"
      onClick={() => onChange({
        business_hours: {
          mon: { open: '10:00', close: '16:00', closed: false },
          tue: { open: '10:00', close: '16:00', closed: false },
          wed: { open: '10:00', close: '16:00', closed: false },
          thu: { open: '10:00', close: '16:00', closed: false },
          fri: { open: '10:00', close: '16:00', closed: false },
          sat: { open: null, close: null, closed: true },
          sun: { open: null, close: null, closed: true },
        },
      })}
    >Apply test hours</button>
  ),
}));

describe('SettingsWorkspace tabs', () => {
  beforeEach(() => {
    replaceMock.mockReset();
    pushMock.mockReset();
    mutateMock.mockReset();
    mockSearch = 'tab=tenant&instagram=connected';
    mockQueryData = {};
  });

  it('changes tabs without scrolling and preserves unrelated query state', () => {
    render(<SettingsWorkspace />);

    fireEvent.click(screen.getByRole('tab', { name: 'Channels' }));

    expect(replaceMock).toHaveBeenCalledWith(
      '/dashboard/settings?tab=whatsapp&instagram=connected',
      { scroll: false },
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('saves the seven-day canonical schedule from the Agent tab', () => {
    mockSearch = 'tab=agent';
    mockQueryData = { displayName: 'Glow Salon' };
    render(<SettingsWorkspace />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply test hours' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0][0]).toMatchObject({
      business_hours: {
        mon: { open: '10:00', close: '16:00', closed: false },
        sun: { open: null, close: null, closed: true },
      },
    });
  });
});
