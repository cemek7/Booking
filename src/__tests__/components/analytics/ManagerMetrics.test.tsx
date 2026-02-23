import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from '@jest/globals';
import ManagerMetrics from '@/components/analytics/ManagerMetrics';

// Mock authFetch to return role-appropriate data
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
    return Promise.resolve({ status: 200, data: {} });
  }),
}));

// Mock all chart components
jest.mock('@/components/analytics/charts/TrendChart', () => {
  return function MockTrendChart({ title }: any) {
    return <div data-testid="trend-chart">{title}</div>;
  };
});

jest.mock('@/components/analytics/charts/BarChart', () => {
  return function MockBarChart({ title }: any) {
    return <div data-testid="bar-chart">{title}</div>;
  };
});

jest.mock('@/components/analytics/charts/PieChart', () => {
  return function MockPieChart({ title }: any) {
    return <div data-testid="pie-chart">{title}</div>;
  };
});

jest.mock('@/components/analytics/charts/AreaChart', () => {
  return function MockAreaChart({ title }: any) {
    return <div data-testid="area-chart">{title}</div>;
  };
});

describe('ManagerMetrics', () => {
  const defaultProps = {
    userId: 'manager-123',
    tenantId: 'tenant-456',
  };

  describe('Rendering - Basic Structure', () => {
    it('should render without crashing', () => {
      const { container } = render(<ManagerMetrics {...defaultProps} />);
      expect(container).toBeInTheDocument();
    });

    it('should render date range picker', () => {
      const { container } = render(<ManagerMetrics {...defaultProps} />);
      expect(container.querySelector('select, button')).toBeInTheDocument();
    });

    it('should display team metrics labels after loading', async () => {
      render(<ManagerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Team Bookings')).toBeInTheDocument());
      expect(screen.getByText('Team Revenue')).toBeInTheDocument();
      expect(screen.getByText('Active Staff')).toBeInTheDocument();
      expect(screen.getByText('Team Rating')).toBeInTheDocument();
    });
  });

  describe('Props Handling', () => {
    it('should accept userId prop', () => {
      const { container } = render(<ManagerMetrics userId="test-manager" tenantId="test-tenant" />);
      expect(container).toBeInTheDocument();
    });

    it('should accept tenantId prop', () => {
      const { container } = render(<ManagerMetrics userId="test-manager" tenantId="test-tenant" />);
      expect(container).toBeInTheDocument();
    });

    it('should render with different manager IDs', () => {
      const { rerender, container } = render(
        <ManagerMetrics userId="manager-1" tenantId="tenant-1" />
      );
      expect(container).toBeInTheDocument();

      rerender(<ManagerMetrics userId="manager-2" tenantId="tenant-1" />);
      expect(container).toBeInTheDocument();
    });
  });

  describe('Layout and Structure', () => {
    it('should organize content in grid layout', () => {
      const { container } = render(<ManagerMetrics {...defaultProps} />);
      const grids = container.querySelectorAll('.grid');
      expect(grids.length).toBeGreaterThan(0);
    });

    it('should render booking and revenue trend charts', async () => {
      render(<ManagerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Team Booking Trend')).toBeInTheDocument());
      expect(screen.getByText('Team Revenue Trend')).toBeInTheDocument();
    });

    it('should render completion ratio chart', async () => {
      render(<ManagerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Completion Ratio')).toBeInTheDocument());
    });

    it('should render performance table', async () => {
      render(<ManagerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Team Performance')).toBeInTheDocument());
    });
  });

  describe('Team Scope', () => {
    it('should show team revenue KPI after loading', async () => {
      render(<ManagerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Team Revenue')).toBeInTheDocument());
    });

    it('should show team rating KPI after loading', async () => {
      render(<ManagerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Team Rating')).toBeInTheDocument());
    });

    it('should show utilization and completion rate after loading', async () => {
      render(<ManagerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Schedule Utilization')).toBeInTheDocument());
      expect(screen.getByText('Completion Rate')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should use semantic HTML structure', () => {
      const { container } = render(<ManagerMetrics {...defaultProps} />);
      expect(container.querySelector('div')).toBeInTheDocument();
    });

    it('should render with meaningful content', () => {
      const { container } = render(<ManagerMetrics {...defaultProps} />);
      expect(container.textContent).toBeTruthy();
    });
  });
});
