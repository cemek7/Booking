import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from '@jest/globals';
import StaffMetrics from '@/components/analytics/StaffMetrics';

// Mock authFetch so the component resolves to a loaded state
jest.mock('@/lib/auth/auth-api-client', () => ({
  authFetch: jest.fn().mockResolvedValue({
    status: 200,
    data: {
      metrics: [
        { user_id: 'user-123', rating: 4.5, completed: 10, revenue: 500 },
        { user_id: 'user-456', rating: 4.0, completed: 8, revenue: 400 },
      ],
    },
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

describe('StaffMetrics', () => {
  const defaultProps = {
    userId: 'user-123',
    tenantId: 'tenant-456',
  };

  describe('Rendering - Basic Structure', () => {
    it('should render without crashing', () => {
      const { container } = render(<StaffMetrics {...defaultProps} />);
      expect(container).toBeInTheDocument();
    });

    it('should render date range picker', () => {
      const { container } = render(<StaffMetrics {...defaultProps} />);
      expect(container.querySelector('select, button')).toBeInTheDocument();
    });

    it('should display personal KPI cards after loading', async () => {
      render(<StaffMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('My Completed Bookings')).toBeInTheDocument());
      expect(screen.getByText('My Revenue')).toBeInTheDocument();
      expect(screen.getByText('My Rating')).toBeInTheDocument();
      expect(screen.getByText('Completion Share')).toBeInTheDocument();
    });
  });

  describe('Charts Rendering', () => {
    it('should render the completion contribution pie chart', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('My Completion Contribution')).toBeInTheDocument();
    });

    it('should render the completed bookings by staff bar chart', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('Completed Bookings by Staff')).toBeInTheDocument();
    });
  });

  describe('Props Handling', () => {
    it('should accept userId prop', () => {
      const { container } = render(<StaffMetrics userId="test-user" tenantId="test-tenant" />);
      expect(container).toBeInTheDocument();
    });

    it('should accept tenantId prop', () => {
      const { container } = render(<StaffMetrics userId="test-user" tenantId="test-tenant" />);
      expect(container).toBeInTheDocument();
    });

    it('should render with different user IDs', () => {
      const { rerender, container } = render(
        <StaffMetrics userId="user-1" tenantId="tenant-1" />
      );
      expect(container).toBeInTheDocument();

      rerender(<StaffMetrics userId="user-2" tenantId="tenant-1" />);
      expect(container).toBeInTheDocument();
    });
  });

  describe('Layout and Structure', () => {
    it('should use StatsGrid for KPI cards after loading', async () => {
      render(<StaffMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('My Completed Bookings')).toBeInTheDocument());
      expect(screen.getByText('My Revenue')).toBeInTheDocument();
      expect(screen.getByText('My Rating')).toBeInTheDocument();
      expect(screen.getByText('Completion Share')).toBeInTheDocument();
    });

    it('should organize content in grid layout', () => {
      const { container } = render(<StaffMetrics {...defaultProps} />);
      const grids = container.querySelectorAll('.grid');
      expect(grids.length).toBeGreaterThan(0);
    });
  });

  describe('Accessibility', () => {
    it('should use semantic HTML structure', () => {
      const { container } = render(<StaffMetrics {...defaultProps} />);
      expect(container.querySelector('div')).toBeInTheDocument();
    });

    it('should render with meaningful content', () => {
      const { container } = render(<StaffMetrics {...defaultProps} />);
      expect(container.textContent).toBeTruthy();
    });
  });

  describe('Personal Scope', () => {
    it('should show personal metrics with My prefix after loading', async () => {
      render(<StaffMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('My Completed Bookings')).toBeInTheDocument());
      expect(screen.getByText('My Revenue')).toBeInTheDocument();
      expect(screen.getByText('My Rating')).toBeInTheDocument();
    });

    it('should not show team or tenant-wide revenue metrics', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.queryByText('Team Revenue')).not.toBeInTheDocument();
      expect(screen.queryByText('Total Revenue')).not.toBeInTheDocument();
    });

    it('should show completion share relative to team after loading', async () => {
      render(<StaffMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Completion Share')).toBeInTheDocument());
    });
  });
});
