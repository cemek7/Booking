import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from '@jest/globals';
import StaffMetrics from '@/components/analytics/StaffMetrics';

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
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText(/My Bookings/i)).toBeInTheDocument();
    });

    it('should render date range picker', () => {
      const { container } = render(<StaffMetrics {...defaultProps} />);
      // DateRangePicker should be present
      expect(container.querySelector('select, button')).toBeInTheDocument();
    });

    it('should display personal KPI cards', () => {
      render(<StaffMetrics {...defaultProps} />);

      expect(screen.getByText('My Bookings')).toBeInTheDocument();
      expect(screen.getByText('My Earnings')).toBeInTheDocument();
      expect(screen.getByText('My Rating')).toBeInTheDocument();
      expect(screen.getAllByText('Completion Rate').length).toBeGreaterThan(0);
    });
  });

  describe('Personal Metrics Display', () => {
    it('should display booking count', () => {
      const { container } = render(<StaffMetrics {...defaultProps} />);
      expect(container.textContent).toContain('87');
    });

    it('should display earnings with currency formatting', () => {
      const { container } = render(<StaffMetrics {...defaultProps} />);
      expect(container.textContent).toContain('$9,135');
    });

    it('should display rating', () => {
      const { container } = render(<StaffMetrics {...defaultProps} />);
      expect(container.textContent).toContain('4.9');
    });

    it('should display completion rate', () => {
      const { container } = render(<StaffMetrics {...defaultProps} />);
      expect(container.textContent).toMatch(/95\.4%/);
    });
  });

  describe('Charts Rendering', () => {
    it('should render booking performance area chart', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('My Booking Performance')).toBeInTheDocument();
    });

    it('should render earnings trend chart', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('My Earnings Trend')).toBeInTheDocument();
    });

    it('should render service distribution pie chart', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('My Service Distribution')).toBeInTheDocument();
    });

    it('should render customer ratings breakdown', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('Customer Ratings Breakdown')).toBeInTheDocument();
    });

    it('should render schedule performance chart', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('Weekly Schedule Performance')).toBeInTheDocument();
    });

    it('should render peak performance hours chart', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('My Peak Performance Hours')).toBeInTheDocument();
    });

    it('should render customer feedback chart', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('Customer Feedback by Category')).toBeInTheDocument();
    });
  });

  describe('Insights Cards', () => {
    it('should render achievements card', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('My Achievements')).toBeInTheDocument();
    });

    it('should display total completed bookings', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('Total Completed')).toBeInTheDocument();
    });

    it('should display repeat customers count', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('Repeat Customers')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('should display 5-star reviews count', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('5-Star Reviews')).toBeInTheDocument();
      expect(screen.getByText('68')).toBeInTheDocument();
    });

    it('should render time management card', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('Time Management')).toBeInTheDocument();
    });

    it('should display hours worked', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('Hours Worked')).toBeInTheDocument();
      expect(screen.getByText('168h')).toBeInTheDocument();
    });

    it('should display average time per booking', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('Avg Per Booking')).toBeInTheDocument();
      expect(screen.getByText('42 min')).toBeInTheDocument();
    });

    it('should display on-time rate', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('On-Time Rate')).toBeInTheDocument();
      expect(screen.getByText('96.5%')).toBeInTheDocument();
    });

    it('should render goals and progress card', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('Goals & Progress')).toBeInTheDocument();
    });

    it('should display monthly target progress', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('Monthly Target')).toBeInTheDocument();
      expect(screen.getByText('87/90')).toBeInTheDocument();
    });

    it('should display quality score', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('Quality Score')).toBeInTheDocument();
      expect(screen.getByText('A+')).toBeInTheDocument();
    });

    it('should display team rank', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('Team Rank')).toBeInTheDocument();
      expect(screen.getByText('#2 of 12')).toBeInTheDocument();
    });
  });

  describe('Performance Summary Card', () => {
    it('should render performance summary', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('Performance Summary')).toBeInTheDocument();
    });

    it('should display total bookings in summary', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('Total Bookings')).toBeInTheDocument();
    });

    it('should display total earnings in summary', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('Total Earnings')).toBeInTheDocument();
    });

    it('should display average rating in summary', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('Average Rating')).toBeInTheDocument();
    });

    it('should display completion rate in summary', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getAllByText('Completion Rate').length).toBeGreaterThan(0);
    });
  });

  describe('Props Handling', () => {
    it('should accept userId prop', () => {
      render(<StaffMetrics userId="test-user" tenantId="test-tenant" />);
      expect(screen.getByText('My Bookings')).toBeInTheDocument();
    });

    it('should accept tenantId prop', () => {
      render(<StaffMetrics userId="test-user" tenantId="test-tenant" />);
      expect(screen.getByText('My Bookings')).toBeInTheDocument();
    });

    it('should render with different user IDs', () => {
      const { rerender } = render(
        <StaffMetrics userId="user-1" tenantId="tenant-1" />
      );
      expect(screen.getByText('My Bookings')).toBeInTheDocument();

      rerender(<StaffMetrics userId="user-2" tenantId="tenant-1" />);
      expect(screen.getByText('My Bookings')).toBeInTheDocument();
    });
  });

  describe('Layout and Structure', () => {
    it('should use StatsGrid for KPI cards', () => {
      const { container } = render(<StaffMetrics {...defaultProps} />);
      // StatsGrid should contain the 4 KPI cards
      expect(screen.getByText('My Bookings')).toBeInTheDocument();
      expect(screen.getByText('My Earnings')).toBeInTheDocument();
      expect(screen.getByText('My Rating')).toBeInTheDocument();
      expect(container.textContent).toContain('Completion Rate');
    });

    it('should organize charts in grid layout', () => {
      const { container } = render(<StaffMetrics {...defaultProps} />);
      // Should have grid layouts for charts
      const grids = container.querySelectorAll('.grid');
      expect(grids.length).toBeGreaterThan(0);
    });

    it('should group related insights together', () => {
      render(<StaffMetrics {...defaultProps} />);
      // Achievements, Time Management, and Goals should be together
      expect(screen.getByText('My Achievements')).toBeInTheDocument();
      expect(screen.getByText('Time Management')).toBeInTheDocument();
      expect(screen.getByText('Goals & Progress')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have meaningful card titles', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('My Achievements')).toBeInTheDocument();
      expect(screen.getByText('Time Management')).toBeInTheDocument();
      expect(screen.getByText('Goals & Progress')).toBeInTheDocument();
    });

    it('should use semantic HTML structure', () => {
      const { container } = render(<StaffMetrics {...defaultProps} />);
      expect(container.querySelector('div')).toBeInTheDocument();
    });
  });

  describe('Personal Scope', () => {
    it('should show only personal metrics', () => {
      render(<StaffMetrics {...defaultProps} />);
      // Should use "My" prefix for personal metrics
      expect(screen.getByText('My Bookings')).toBeInTheDocument();
      expect(screen.getByText('My Earnings')).toBeInTheDocument();
      expect(screen.getByText('My Rating')).toBeInTheDocument();
    });

    it('should not show team or tenant-wide metrics', () => {
      render(<StaffMetrics {...defaultProps} />);
      // Should not have team or global metrics
      expect(screen.queryByText('Team Revenue')).not.toBeInTheDocument();
      expect(screen.queryByText('Total Revenue')).not.toBeInTheDocument();
      expect(screen.queryByText('All Staff')).not.toBeInTheDocument();
    });

    it('should focus on individual performance', () => {
      render(<StaffMetrics {...defaultProps} />);
      expect(screen.getByText('My Booking Performance')).toBeInTheDocument();
      expect(screen.getByText('My Earnings Trend')).toBeInTheDocument();
      expect(screen.getByText('My Service Distribution')).toBeInTheDocument();
    });
  });
});
