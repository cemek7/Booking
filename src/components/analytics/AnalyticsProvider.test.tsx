// src/components/analytics/AnalyticsProvider.test.tsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const initMock = jest.fn();
const optInMock = jest.fn();
const optOutMock = jest.fn();
const captureMock = jest.fn();
const identifyMock = jest.fn();
const resetMock = jest.fn();
jest.mock('posthog-js', () => ({
  __esModule: true,
  default: {
    init: initMock,
    opt_in_capturing: optInMock,
    opt_out_capturing: optOutMock,
    capture: captureMock,
    identify: identifyMock,
    reset: resetMock,
  },
}));
jest.mock('posthog-js/react', () => ({
  __esModule: true,
  PostHogProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// AnalyticsProvider now renders PostHogPageview, which reads the router.
jest.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import AnalyticsProvider from '@/components/analytics/AnalyticsProvider';
import { setConsent } from '@/lib/consent/consentStore';

describe('AnalyticsProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    global.fetch = jest.fn() as typeof fetch;
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ posthogKey: null, posthogHost: 'https://us.i.posthog.com' }),
    });
    initMock.mockClear();
    optInMock.mockClear();
    optOutMock.mockClear();
    captureMock.mockClear();
    identifyMock.mockClear();
    resetMock.mockClear();
  });

  it('renders children', () => {
    render(<AnalyticsProvider><span>hi</span></AnalyticsProvider>);
    expect(screen.getByText('hi')).toBeInTheDocument();
  });

  it('does NOT init PostHog when no key is configured', () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ posthogKey: null, posthogHost: 'https://us.i.posthog.com' }),
    });

    render(<AnalyticsProvider><span>hi</span></AnalyticsProvider>);
    expect(initMock).not.toHaveBeenCalled();
  });

  it('inits PostHog opted-out by default and opts out with no consent', () => {
    render(
      <AnalyticsProvider posthogKey="phc_test" posthogHost="https://us.i.posthog.com">
        <span>hi</span>
      </AnalyticsProvider>,
    );
    expect(initMock).toHaveBeenCalledTimes(1);
    const [, options] = initMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.opt_out_capturing_by_default).toBe(true);
    expect(options.capture_pageview).toBe(false);
    // Session replay masks all text + inputs (PII never leaves the browser).
    expect(options.session_recording).toEqual({ maskAllInputs: true, maskTextSelector: '*' });
    expect(optOutMock).toHaveBeenCalled();
    expect(optInMock).not.toHaveBeenCalled();
  });

  it('opts in before capturing the first pageview after consent is granted', async () => {
    render(
      <AnalyticsProvider posthogKey="phc_test" posthogHost="https://us.i.posthog.com">
        <span>hi</span>
      </AnalyticsProvider>,
    );

    optInMock.mockClear();
    captureMock.mockClear();

    setConsent(true);
    await Promise.resolve();

    expect(optInMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledWith('$pageview', {
      $current_url: `${window.origin}/`,
    });
    expect(optInMock.mock.invocationCallOrder[0]).toBeLessThan(captureMock.mock.invocationCallOrder[0]);
  });

  it('fetches runtime config when build-time props are absent', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ posthogKey: 'phc_runtime', posthogHost: 'https://us.i.posthog.com' }),
    });

    render(
      <AnalyticsProvider>
        <span>hi</span>
      </AnalyticsProvider>,
    );

    await waitFor(() => {
      expect(initMock).toHaveBeenCalledWith(
        'phc_runtime',
        expect.objectContaining({
          api_host: 'https://us.i.posthog.com',
          defaults: '2026-05-30',
          opt_out_capturing_by_default: true,
        }),
      );
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/client-config', { cache: 'no-store' });
  });
});
