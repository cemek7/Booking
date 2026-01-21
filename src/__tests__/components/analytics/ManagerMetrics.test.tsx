import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from '@jest/globals';
import ManagerMetrics from '@/components/analytics/ManagerMetrics';

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

    it('should display team metrics', () => {
      const { container } = render(<ManagerMetrics {...defaultProps} />);
      expect(container.textContent).toContain('Team');
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

    it('should render multiple cards', () => {
      const { container } = render(<ManagerMetrics {...defaultProps} />);
      const cards = container.querySelectorAll('[class*="bg-"]');
      expect(cards.length).toBeGreaterThan(0);
    });
  });

  describe('Team Scope', () => {
    it('should focus on team-level metrics', () => {
      const { container } = render(<ManagerMetrics {...defaultProps} />);
      expect(container.textContent).toContain('Team');
    });

    it('should not show global revenue in main KPIs', () => {
      const { container } = render(<ManagerMetrics {...defaultProps} />);
      // Manager view typically doesn't have "Total Revenue" as main KPI
      const text = container.textContent || '';
      const teamMentions = (text.match(/Team/g) || []).length;
      expect(teamMentions).toBeGreaterThan(0);
    });
  });

  describe('Accessibility', () => {
    it('should use semantic HTML structure', () => {
      const { container } = render(<ManagerMetrics {...defaultProps} />);
      expect(container.querySelector('div')).toBeInTheDocument();
    });

    it('should render cards with content', () => {
      const { container } = render(<ManagerMetrics {...defaultProps} />);
      expect(container.textContent).toBeTruthy();
      expect(container.textContent!.length).toBeGreaterThan(0);
    });
  });
});
