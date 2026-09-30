import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jest } from '@jest/globals';
import OnboardingPage from './OnboardingClientPage';

const replace = jest.fn();
const push = jest.fn();
const authSubscription = { unsubscribe: jest.fn() };

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/lib/supabase/client', () => ({
  getSupabaseBrowserClientAsync: jest.fn(async () => ({
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: { access_token: 'test-token' } },
      })),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: authSubscription } })),
    },
  })),
}));

function seedMotion(commercialMotion: 'booking' | 'sales' | 'hybrid' | 'enquiry') {
  const draft = {
    name: 'Glow Salon',
    timezone: 'Africa/Lagos',
    description: '',
    businessType: 'salon',
    ownerName: 'Owner',
    ownerEmail: 'owner@example.com',
    ownerPhone: '+2348012345678',
    businessNickname: 'Glow',
    bookingSources: ['whatsapp'],
    commercialMotion,
  };
  sessionStorage.setItem('booka_onboarding_draft', JSON.stringify(draft));
}

describe('onboarding retail fulfillment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('keeps fulfilment hidden for a service-only tenant until a product is entered', async () => {
    seedMotion('booking');
    render(<OnboardingPage initialResumeMode initialTenantId="tenant-1" />);

    expect(await screen.findByText('What you offer')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'Order fulfilment' })).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Product name (e.g. Shea butter 250g)'), {
      target: { value: 'Edge control' },
    });

    expect(screen.getByRole('group', { name: 'Order fulfilment' })).toBeInTheDocument();
  });

  it('sends the complete policy and advances only after a successful save', async () => {
    seedMotion('sales');
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({ ok: true } as Response);
    global.fetch = fetchMock;
    render(<OnboardingPage initialResumeMode initialTenantId="tenant-1" />);

    await screen.findByRole('group', { name: 'Order fulfilment' });
    fireEvent.click(screen.getByRole('checkbox', { name: /^Customers pick up from us/ }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue →' }));
    });

    expect(await screen.findByText('Invite your team')).toBeInTheDocument();
    const settingsCall = fetchMock.mock.calls.find(([url]) => (
      String(url) === '/api/tenants/tenant-1/settings'
    ));
    expect(settingsCall).toBeDefined();
    expect(JSON.parse(String(settingsCall?.[1]?.body))).toMatchObject({
      retailFulfillment: {
        methods: ['customer_pickup'],
        thirdPartyProviders: [],
        serviceAreas: [],
        feePolicy: 'included',
      },
    });
  });

  it('retains the policy and stays on Offerings when the settings save fails', async () => {
    seedMotion('hybrid');
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({ ok: false, status: 500 } as Response);
    render(<OnboardingPage initialResumeMode initialTenantId="tenant-1" />);

    await screen.findByRole('group', { name: 'Order fulfilment' });
    const pickup = screen.getByRole('checkbox', { name: /^Customers pick up from us/ });
    fireEvent.click(pickup);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue →' }));
    });

    expect(screen.getByText('What you offer')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^Customers pick up from us/ })).toBeChecked();
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be saved/i);
  });
});
