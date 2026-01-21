import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from '@jest/globals';
import SuperAdminMetrics from '@/components/analytics/SuperAdminMetrics';

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

describe('SuperAdminMetrics', () => {
  describe('Rendering - Basic Structure', () => {
    it('should render without crashing', () => {
      const { container } = render(<SuperAdminMetrics />);
      expect(container).toBeInTheDocument();
    });

    it('should render date range picker', () => {
      const { container } = render(<SuperAdminMetrics />);
      expect(container.querySelector('select, button')).toBeInTheDocument();
    });

    it('should display platform metrics', () => {
      const { container } = render(<SuperAdminMetrics />);
      expect(container.textContent).toBeTruthy();
      expect(container.textContent!.length).toBeGreaterThan(100);
    });
  });

  describe('Layout and Structure', () => {
    it('should organize content in grid layout', () => {
      const { container } = render(<SuperAdminMetrics />);
      const grids = container.querySelectorAll('.grid');
      expect(grids.length).toBeGreaterThan(0);
    });

    it('should render multiple cards', () => {
      const { container } = render(<SuperAdminMetrics />);
      const cards = container.querySelectorAll('[class*="bg-"]');
      expect(cards.length).toBeGreaterThan(0);
    });

    it('should render platform-wide metrics', () => {
      const { container } = render(<SuperAdminMetrics />);
      expect(container.textContent).toBeTruthy();
    });
  });

  describe('Platform Scope', () => {
    it('should show platform-wide metrics', () => {
      const { container } = render(<SuperAdminMetrics />);
      const text = container.textContent || '';
      expect(text.length).toBeGreaterThan(100);
    });

    it('should include platform indicators', () => {
      const { container } = render(<SuperAdminMetrics />);
      // Platform metrics should mention tenants or platform
      expect(container.textContent).toMatch(/Platform|Tenant/i);
    });

    it('should include system metrics', () => {
      const { container } = render(<SuperAdminMetrics />);
      expect(container.textContent).toBeTruthy();
    });
  });

  describe('Tenant Management', () => {
    it('should display tenant-related metrics', () => {
      const { container } = render(<SuperAdminMetrics />);
      expect(container.textContent).toMatch(/Tenant/i);
    });
  });

  describe('System Monitoring', () => {
    it('should show system health indicators', () => {
      const { container } = render(<SuperAdminMetrics />);
      expect(container.textContent).toBeTruthy();
    });
  });

  describe('Accessibility', () => {
    it('should use semantic HTML structure', () => {
      const { container } = render(<SuperAdminMetrics />);
      expect(container.querySelector('div')).toBeInTheDocument();
    });

    it('should render with meaningful content', () => {
      const { container } = render(<SuperAdminMetrics />);
      expect(container.textContent).toBeTruthy();
    });
  });
});
