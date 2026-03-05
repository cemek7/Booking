import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OwnerMetrics from '@/components/analytics/OwnerMetrics';

// Mock authFetch so queries resolve immediately with non-empty data
jest.mock('@/lib/auth/auth-api-client', () => ({
  authFetch: jest.fn().mockResolvedValue({
    status: 200,
    data: {
      metrics: [
        { id: 'total_revenue', name: 'Total Revenue', value: 1000, trend: 5, type: 'currency', period: 'month', last_updated: '' },
        { id: 'total_bookings', name: 'Total Bookings', value: 50, trend: 2, type: 'count', period: 'month', last_updated: '' },
        { id: 'new_customers', name: 'New Customers', value: 10, trend: 1, type: 'count', period: 'month', last_updated: '' },
        { id: 'cancellation_rate', name: 'Cancellation Rate', value: 5, trend: -1, type: 'percentage', period: 'month', last_updated: '' },
        { id: 'no_show_rate', name: 'No-Show Rate', value: 3, trend: 0, type: 'percentage', period: 'month', last_updated: '' },
        { id: 'avg_booking_value', name: 'Avg Booking Value', value: 80, trend: 3, type: 'currency', period: 'month', last_updated: '' },
        { id: 'staff_utilization', name: 'Staff Utilization', value: 72, trend: 4, type: 'percentage', period: 'month', last_updated: '' },
      ],
      trends: [],
      performance: [],
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

jest.mock('@/components/analytics/shared/PerformanceTable', () => {
  return function MockPerformanceTable({ title }: any) {
    return <div data-testid="performance-table">{title}</div>;
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

describe('OwnerMetrics', () => {
  const defaultProps = {
    tenantId: 'tenant-456',
  };

  describe('Rendering - Basic Structure', () => {
    it('should render without crashing', () => {
      const { container } = renderWithQueryClient(<OwnerMetrics {...defaultProps} />);
      expect(container).toBeInTheDocument();
    });

    it('should render date range picker', () => {
      const { container } = renderWithQueryClient(<OwnerMetrics {...defaultProps} />);
      expect(container.querySelector('select, button')).toBeInTheDocument();
    });

    it('should display primary KPI labels after loading', async () => {
      renderWithQueryClient(<OwnerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Total Revenue')).toBeInTheDocument());
      expect(screen.getByText('Total Bookings')).toBeInTheDocument();
      expect(screen.getByText('New Customers')).toBeInTheDocument();
      expect(screen.getByText('Average Rating')).toBeInTheDocument();
    });

    it('should display operational KPI labels after loading', async () => {
      renderWithQueryClient(<OwnerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Cancellation Rate')).toBeInTheDocument());
      expect(screen.getByText('No-Show Rate')).toBeInTheDocument();
      expect(screen.getByText('Avg Booking Value')).toBeInTheDocument();
    });
  });

  describe('Props Handling', () => {
    it('should accept tenantId prop', () => {
      const { container } = renderWithQueryClient(<OwnerMetrics tenantId="test-tenant" />);
      expect(container).toBeInTheDocument();
    });

    it('should render with different tenant IDs', () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { rerender, container } = render(
        <QueryClientProvider client={queryClient}><OwnerMetrics tenantId="tenant-1" /></QueryClientProvider>
      );
      expect(container).toBeInTheDocument();

      rerender(
        <QueryClientProvider client={queryClient}><OwnerMetrics tenantId="tenant-2" /></QueryClientProvider>
      );
      expect(container).toBeInTheDocument();
    });
  });

  describe('Layout and Structure', () => {
    it('should organize content in grid layout', () => {
      const { container } = renderWithQueryClient(<OwnerMetrics {...defaultProps} />);
      const grids = container.querySelectorAll('.grid');
      expect(grids.length).toBeGreaterThan(0);
    });

    it('should render revenue and booking trend charts', async () => {
      renderWithQueryClient(<OwnerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Revenue Trend')).toBeInTheDocument());
      expect(screen.getByText('Booking Trend')).toBeInTheDocument();
    });

    it('should render status breakdown chart', async () => {
      renderWithQueryClient(<OwnerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Booking Status Breakdown')).toBeInTheDocument());
    });

    it('should render staff performance table', async () => {
      renderWithQueryClient(<OwnerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Staff Performance')).toBeInTheDocument());
    });
  });

  describe('Business Scope', () => {
    it('should include financial data labels', async () => {
      renderWithQueryClient(<OwnerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Total Revenue')).toBeInTheDocument());
    });

    it('should include cancellation tracking labels', async () => {
      renderWithQueryClient(<OwnerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Cancellation Rate')).toBeInTheDocument());
    });

    it('should include staff utilization label', async () => {
      renderWithQueryClient(<OwnerMetrics {...defaultProps} />);
      await waitFor(() => expect(screen.getByText('Staff Utilization')).toBeInTheDocument());
    });
  });

  describe('Accessibility', () => {
    it('should use semantic HTML structure', () => {
      const { container } = renderWithQueryClient(<OwnerMetrics {...defaultProps} />);
      expect(container.querySelector('div')).toBeInTheDocument();
    });

    it('should render with meaningful content', () => {
      const { container } = renderWithQueryClient(<OwnerMetrics {...defaultProps} />);
      expect(container.textContent).toBeTruthy();
    });
  });
});
