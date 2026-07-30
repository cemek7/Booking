import { describe, it, expect, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

let mockPath = '/';
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }));
jest.mock('@/components/analytics/AnalyticsProvider', () => ({ __esModule: true, default: ({ children }: any) => <div data-testid="analytics">{children}</div> }));
jest.mock('@/components/consent/ConsentBanner', () => ({ __esModule: true, default: () => <div data-testid="consent" /> }));
jest.mock('@/components/AuthHashRedirect', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/toast', () => ({ ToastContainer: () => null }));

import RootChrome from './RootChrome';

describe('RootChrome', () => {
  it('renders Booka analytics + consent on normal routes', () => {
    mockPath = '/';
    render(<RootChrome><span>child</span></RootChrome>);
    expect(screen.getByTestId('analytics')).toBeTruthy();
    expect(screen.getByTestId('consent')).toBeTruthy();
    expect(screen.getByText('child')).toBeTruthy();
  });

  it('suppresses analytics + consent on /showcase routes', () => {
    mockPath = '/showcase/demos/sungrid-energy';
    render(<RootChrome><span>child</span></RootChrome>);
    expect(screen.queryByTestId('analytics')).toBeNull();
    expect(screen.queryByTestId('consent')).toBeNull();
    expect(screen.getByText('child')).toBeTruthy();
  });
});
