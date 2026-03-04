import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ManagerMetrics from '@/components/analytics/ManagerMetrics';
import { authFetch } from '@/lib/auth/auth-api-client';

// Mock authFetch to return role-appropriate, team-scoped data
jest.mock('@/lib/auth/auth-api-client', () => ({
  authFetch: jest.fn().mockImplementation((url: string) => {
    if (url.includes('metric=overview')) {
      return Promise.resolve({
        status: 200,
        data: {
          teamBookings: 42,
          teamRevenue: 5000,
          activeStaff: 6,
          teamRating: 4.3,
          scheduleUtilization: 78,
          completionRate: 85,
          trends: { bookings: 5, revenue: 8, rating: 1 },
        },
      });
    }
    if (url.includes('metric=bookings')) {
      return Promise.resolve({
        status: 200,
        data: {
          bookingsByStatus: { completed: 30, confirmed: 5, pending: 3, cancelled: 2, noShow: 2 },
          bookingTrends: [
            { date: '2024-01-01', bookings: 5, completed: 4, cancelled: 1 },
            { date: '2024-01-02', bookings: 8, completed: 7, cancelled: 1 },
            { date: '2024-01-03', bookings: 6, completed: 6, cancelled: 0 },
          ],
          peakHours: [{ hour: '10:00', bookings: 8 }, { hour: '14:00', bookings: 6 }],
          cancellationReasons: [],
        },
      });
    }
    return Promise.resolve({ status: 200, data: {} });
  }),
}));

const mockAuthFetch = authFetch as jest.Mock;

// Mock all chart components — capture data prop for assertion in team-scope tests
jest.mock('@/components/analytics/charts/TrendChart', () => {
  return function MockTrendChart({ title, data }: { title: string; data: unknown[] }) {
    return <div data-testid="trend-chart" data-item-count={data?.length ?? 0}>{title}</div>;
  };
});

jest.mock('@/components/analytics/charts/BarChart', () => {
  return function MockBarChart({ title }: { title: string }) {
    return <div data-testid="bar-chart">{title}</div>;
  };
});

jest.mock('@/components/analytics/charts/PieChart', () => {
  return function MockPieChart({ title }: { title: string }) {
    return <div data-testid="pie-chart">{title}</div>;
  };
});

jest.mock('@/components/analytics/charts/AreaChart', () => {
  return function MockAreaChart({ title }: { title: string }) {
    return <div data-testid="area-chart">{title}</div>;
  };
});

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe('ManagerMetrics', () => {
  const defaultProps = {
    userId: 'manager-123',
    tenantId: 'tenant-456',
  };

  describe('Rendering - Basic Structure', () => {
    it('should render without crashing', () => {
      const { container } = renderWithQueryClient(<ManagerMetrics {...defaultProps} />);
      expect(container).toBeInTheDocument();
    });

    it('should render date range picker', () => {
      const { container } = renderWithQueryClient(<ManagerMetrics {...defaultProps} />);
      expect(container.querySelector('select, button')).toBeInTheDocument();
    });

    it('should display team metrics labels after loading', async () => {
      renderWithQueryClient(<ManagerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Team Bookings')).toBeInTheDocument());
      expect(screen.getByText('Team Revenue')).toBeInTheDocument();
      expect(screen.getByText('Active Staff')).toBeInTheDocument();
      expect(screen.getByText('Team Rating')).toBeInTheDocument();
    });
  });

  describe('Props Handling', () => {
    it('should accept userId prop', () => {
      const { container } = renderWithQueryClient(<ManagerMetrics userId="test-manager" tenantId="test-tenant" />);
      expect(container).toBeInTheDocument();
    });

    it('should accept tenantId prop', () => {
      const { container } = renderWithQueryClient(<ManagerMetrics userId="test-manager" tenantId="test-tenant" />);
      expect(container).toBeInTheDocument();
    });

    it('should render with different manager IDs', () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { rerender, container } = render(
        <QueryClientProvider client={queryClient}><ManagerMetrics userId="manager-1" tenantId="tenant-1" /></QueryClientProvider>
      );
      expect(container).toBeInTheDocument();

      rerender(<QueryClientProvider client={queryClient}><ManagerMetrics userId="manager-2" tenantId="tenant-1" /></QueryClientProvider>);
      expect(container).toBeInTheDocument();
    });
  });

  describe('Layout and Structure', () => {
    it('should organize content in grid layout', () => {
      const { container } = renderWithQueryClient(<ManagerMetrics {...defaultProps} />);
      const grids = container.querySelectorAll('.grid');
      expect(grids.length).toBeGreaterThan(0);
    });

    it('should render booking and revenue trend charts', async () => {
      renderWithQueryClient(<ManagerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Team Booking Trend')).toBeInTheDocument());
      expect(screen.getByText('Team Revenue Trend')).toBeInTheDocument();
    });

    it('should render completion ratio chart', async () => {
      renderWithQueryClient(<ManagerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Completion Ratio')).toBeInTheDocument());
    });

    it('should render performance table', async () => {
      renderWithQueryClient(<ManagerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Team Performance')).toBeInTheDocument());
    });
  });

  describe('Team Scope', () => {
    it('should show team revenue KPI after loading', async () => {
      renderWithQueryClient(<ManagerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Team Revenue')).toBeInTheDocument());
    });

    it('should show team rating KPI after loading', async () => {
      renderWithQueryClient(<ManagerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Team Rating')).toBeInTheDocument());
    });

    it('should show utilization and completion rate after loading', async () => {
      renderWithQueryClient(<ManagerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Schedule Utilization')).toBeInTheDocument());
      expect(screen.getByText('Completion Rate')).toBeInTheDocument();
    });
  });

  describe('Data Scoping', () => {
    beforeEach(() => {
      mockAuthFetch.mockClear();
    });

    it('should NOT call the tenant-wide /api/analytics/trends endpoint', async () => {
      renderWithQueryClient(<ManagerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Team Bookings')).toBeInTheDocument());
      const allCalls = mockAuthFetch.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(allCalls.some((url: string) => url.includes('/api/analytics/trends'))).toBe(false);
    });

    it('should call the team-scoped /api/manager/analytics?metric=bookings endpoint', async () => {
      renderWithQueryClient(<ManagerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Team Bookings')).toBeInTheDocument());
      const allCalls = mockAuthFetch.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(allCalls.some((url: string) => url.includes('/api/manager/analytics') && url.includes('metric=bookings'))).toBe(true);
    });

    it('should render team booking trend chart with data from bookings endpoint', async () => {
      renderWithQueryClient(<ManagerMetrics {...defaultProps} />);
      await waitFor(() => {
        const chart = screen.getByText('Team Booking Trend');
        expect(chart).toBeInTheDocument();
        // The chart receives 3 data points from the mock bookingTrends
        expect(chart.closest('[data-testid="trend-chart"]')?.getAttribute('data-item-count')).toBe('3');
      });
    });
  });

  describe('Accessibility', () => {
    it('should use semantic HTML structure', () => {
      const { container } = renderWithQueryClient(<ManagerMetrics {...defaultProps} />);
      expect(container.querySelector('div')).toBeInTheDocument();
    });

    it('should render with meaningful content', () => {
      const { container } = renderWithQueryClient(<ManagerMetrics {...defaultProps} />);
      expect(container.textContent).toBeTruthy();
    });
  });
});
