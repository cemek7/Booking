import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import SettingsWorkspace from './SettingsWorkspace';

const replaceMock = jest.fn();
const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
  useSearchParams: () => new URLSearchParams('tab=tenant&instagram=connected'),
}));

jest.mock('@/lib/supabase/tenant-context', () => ({
  useTenant: () => ({ tenant: { id: 'tenant-123' } }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: {}, isLoading: false }),
  useMutation: () => ({ mutate: jest.fn(), isPending: false }),
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
jest.mock('@/components/settings/AgentConfigSection', () => ({ AgentConfigSection: () => null }));

describe('SettingsWorkspace tabs', () => {
  beforeEach(() => {
    replaceMock.mockReset();
    pushMock.mockReset();
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
});
