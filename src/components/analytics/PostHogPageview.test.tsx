import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const captureMock = jest.fn();
jest.mock('posthog-js', () => ({ __esModule: true, default: { capture: captureMock } }));

let mockPathname = '/dashboard';
const mockSearchParams = new URLSearchParams('tab=overview');
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

import PostHogPageview from '@/components/analytics/PostHogPageview';
import { setConsent } from '@/lib/consent/consentStore';

describe('PostHogPageview', () => {
  beforeEach(() => {
    window.localStorage.clear();
    captureMock.mockClear();
    mockPathname = '/dashboard';
  });

  it('captures $pageview with the full URL when consent is granted', () => {
    setConsent(true);
    render(<PostHogPageview />);
    expect(captureMock).toHaveBeenCalledWith('$pageview', {
      $current_url: `${window.origin}/dashboard?tab=overview`,
    });
  });

  it('does NOT capture without analytics consent', () => {
    render(<PostHogPageview />);
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('captures the current page when consent is granted after mount', () => {
    render(<PostHogPageview />);
    expect(captureMock).not.toHaveBeenCalled();

    setConsent(true);

    expect(captureMock).toHaveBeenCalledWith('$pageview', {
      $current_url: `${window.origin}/dashboard?tab=overview`,
    });
    expect(captureMock).toHaveBeenCalledTimes(1);
  });
});
