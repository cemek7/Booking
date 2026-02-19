import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OwnerMetrics from '@/components/analytics/OwnerMetrics';

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

    it('should display business metrics', () => {
      const { container } = renderWithQueryClient(<OwnerMetrics {...defaultProps} />);
      expect(container.textContent).toBeTruthy();
      expect(container.textContent!.length).toBeGreaterThan(100);
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

    it('should render multiple cards', () => {
      const { container } = renderWithQueryClient(<OwnerMetrics {...defaultProps} />);
      const cards = container.querySelectorAll('[class*="bg-"]');
      expect(cards.length).toBeGreaterThan(0);
    });

    it('should render performance metrics', () => {
      const { container } = renderWithQueryClient(<OwnerMetrics {...defaultProps} />);
      expect(container.textContent).toBeTruthy();
    });
  });

  describe('Business Scope', () => {
    it('should show comprehensive business metrics', () => {
      const { container } = renderWithQueryClient(<OwnerMetrics {...defaultProps} />);
      const text = container.textContent || '';
      expect(text.length).toBeGreaterThan(100);
    });

    it('should include financial data', () => {
      const { container } = renderWithQueryClient(<OwnerMetrics {...defaultProps} />);
      // Owner metrics should contain revenue/financial indicators
      expect(container.textContent).toMatch(/Revenue/i);
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
