// src/components/analytics/AnalyticsProvider.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const initMock = jest.fn();
const optInMock = jest.fn();
const optOutMock = jest.fn();
jest.mock('posthog-js', () => ({
  __esModule: true,
  default: { init: initMock, opt_in_capturing: optInMock, opt_out_capturing: optOutMock },
}));
jest.mock('posthog-js/react', () => ({
  __esModule: true,
  PostHogProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import AnalyticsProvider from '@/components/analytics/AnalyticsProvider';

describe('AnalyticsProvider', () => {
  const original = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  beforeEach(() => {
    window.localStorage.clear();
    initMock.mockClear();
    optInMock.mockClear();
    optOutMock.mockClear();
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = original;
  });

  it('renders children', () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    render(<AnalyticsProvider><span>hi</span></AnalyticsProvider>);
    expect(screen.getByText('hi')).toBeInTheDocument();
  });

  it('does NOT init PostHog when no key is configured', () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    render(<AnalyticsProvider><span>hi</span></AnalyticsProvider>);
    expect(initMock).not.toHaveBeenCalled();
  });

  it('inits PostHog opted-out by default and opts out with no consent', () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test';
    render(<AnalyticsProvider><span>hi</span></AnalyticsProvider>);
    expect(initMock).toHaveBeenCalledTimes(1);
    const [, options] = initMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.opt_out_capturing_by_default).toBe(true);
    expect(options.capture_pageview).toBe(false);
    expect(optOutMock).toHaveBeenCalled();
    expect(optInMock).not.toHaveBeenCalled();
  });
});
