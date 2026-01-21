import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from '@jest/globals';
import MetricCard from '@/components/analytics/shared/MetricCard';
import { DollarSign, Users, TrendingUp } from 'lucide-react';

describe('MetricCard', () => {
  describe('Rendering', () => {
    it('should render label correctly', () => {
      render(<MetricCard label="Total Revenue" value={1000} />);
      expect(screen.getByText('Total Revenue')).toBeInTheDocument();
    });

    it('should render numeric value correctly', () => {
      render(<MetricCard label="Count" value={42} />);
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('should render string value correctly', () => {
      render(<MetricCard label="Status" value="Active" />);
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('should render with custom className', () => {
      const { container } = render(
        <MetricCard label="Test" value={100} className="custom-class" />
      );
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('Value Formatting', () => {
    it('should use formatValue function when provided', () => {
      render(
        <MetricCard
          label="Revenue"
          value={1000}
          formatValue={(v) => `$${v.toLocaleString()}`}
        />
      );
      expect(screen.getByText('$1,000')).toBeInTheDocument();
    });

    it('should format numbers with toLocaleString by default', () => {
      render(<MetricCard label="Count" value={1000000} />);
      expect(screen.getByText('1,000,000')).toBeInTheDocument();
    });

    it('should handle string values without formatting', () => {
      render(<MetricCard label="Status" value="Completed" />);
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });

    it('should handle zero value', () => {
      render(<MetricCard label="Count" value={0} />);
      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('should handle negative values', () => {
      render(<MetricCard label="Change" value={-50} />);
      expect(screen.getByText('-50')).toBeInTheDocument();
    });

    it('should handle decimal values', () => {
      render(<MetricCard label="Rate" value={4.85} />);
      expect(screen.getByText('4.85')).toBeInTheDocument();
    });
  });

  describe('Trend Indicator', () => {
    it('should show positive trend with TrendingUp icon', () => {
      const { container } = render(
        <MetricCard label="Revenue" value={1000} trend={15.5} />
      );
      expect(screen.getByText('+15.5%')).toBeInTheDocument();
      expect(container.querySelector('.text-green-600')).toBeInTheDocument();
    });

    it('should show negative trend with TrendingDown icon', () => {
      const { container } = render(
        <MetricCard label="Revenue" value={1000} trend={-10.2} />
      );
      expect(screen.getByText('-10.2%')).toBeInTheDocument();
      expect(container.querySelector('.text-red-600')).toBeInTheDocument();
    });

    it('should show neutral trend with Minus icon', () => {
      const { container } = render(
        <MetricCard label="Revenue" value={1000} trend={0} />
      );
      expect(screen.getByText('0.0%')).toBeInTheDocument();
      expect(container.querySelector('.text-muted-foreground')).toBeInTheDocument();
    });

    it('should not show trend when undefined', () => {
      render(<MetricCard label="Revenue" value={1000} />);
      expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    });

    it('should show custom trend label', () => {
      render(
        <MetricCard
          label="Revenue"
          value={1000}
          trend={12.5}
          trendLabel="vs yesterday"
        />
      );
      expect(screen.getByText('vs yesterday')).toBeInTheDocument();
    });

    it('should default to "vs last period" trend label', () => {
      render(<MetricCard label="Revenue" value={1000} trend={12.5} />);
      expect(screen.getByText('vs last period')).toBeInTheDocument();
    });

    it('should format trend to 1 decimal place', () => {
      render(<MetricCard label="Revenue" value={1000} trend={12.456789} />);
      expect(screen.getByText('+12.5%')).toBeInTheDocument();
    });
  });

  describe('Icon Display', () => {
    it('should render icon when provided', () => {
      const { container } = render(
        <MetricCard label="Revenue" value={1000} icon={DollarSign} />
      );
      // Icon should be in the DOM
      const icon = container.querySelector('svg');
      expect(icon).toBeInTheDocument();
    });

    it('should not render icon when not provided', () => {
      const { container } = render(<MetricCard label="Revenue" value={1000} />);
      // No icon in header
      const header = container.querySelector('.flex.items-center.justify-between');
      const icon = header?.querySelector('svg');
      expect(icon).not.toBeInTheDocument();
    });

    it('should render multiple different icons', () => {
      const { rerender, container } = render(
        <MetricCard label="Revenue" value={1000} icon={DollarSign} />
      );
      expect(container.querySelector('svg')).toBeInTheDocument();

      rerender(<MetricCard label="Users" value={50} icon={Users} />);
      expect(container.querySelector('svg')).toBeInTheDocument();

      rerender(<MetricCard label="Growth" value={15} icon={TrendingUp} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('Color Schemes', () => {
    it('should apply default color scheme', () => {
      const { container } = render(<MetricCard label="Test" value={100} />);
      const card = container.firstChild;
      expect(card).toBeInTheDocument();
    });

    it('should apply success color scheme', () => {
      const { container } = render(
        <MetricCard label="Test" value={100} colorScheme="success" />
      );
      expect(container.querySelector('.border-green-200')).toBeInTheDocument();
    });

    it('should apply warning color scheme', () => {
      const { container } = render(
        <MetricCard label="Test" value={100} colorScheme="warning" />
      );
      expect(container.querySelector('.border-amber-200')).toBeInTheDocument();
    });

    it('should apply error color scheme', () => {
      const { container } = render(
        <MetricCard label="Test" value={100} colorScheme="error" />
      );
      expect(container.querySelector('.border-red-200')).toBeInTheDocument();
    });

    it('should apply info color scheme', () => {
      const { container } = render(
        <MetricCard label="Test" value={100} colorScheme="info" />
      );
      expect(container.querySelector('.border-blue-200')).toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('should show loading skeleton when loading is true', () => {
      const { container } = render(
        <MetricCard label="Test" value={100} loading={true} />
      );
      const skeletons = container.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it('should not show content when loading', () => {
      render(<MetricCard label="Test" value={100} loading={true} />);
      expect(screen.queryByText('Test')).not.toBeInTheDocument();
      expect(screen.queryByText('100')).not.toBeInTheDocument();
    });

    it('should show content when not loading', () => {
      render(<MetricCard label="Test" value={100} loading={false} />);
      expect(screen.getByText('Test')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('should default to not loading', () => {
      render(<MetricCard label="Test" value={100} />);
      expect(screen.getByText('Test')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper semantic structure', () => {
      const { container } = render(<MetricCard label="Revenue" value={1000} />);
      // Should be wrapped in a card component
      expect(container.firstChild).toHaveClass('relative', 'overflow-hidden');
    });

    it('should display label as muted text', () => {
      render(<MetricCard label="Total Revenue" value={1000} />);
      const label = screen.getByText('Total Revenue');
      expect(label).toHaveClass('text-muted-foreground');
    });

    it('should display value prominently', () => {
      render(<MetricCard label="Revenue" value={1000} />);
      const value = screen.getByText('1,000');
      expect(value).toHaveClass('text-3xl', 'font-bold');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large numbers', () => {
      render(<MetricCard label="Count" value={999999999} />);
      expect(screen.getByText('999,999,999')).toBeInTheDocument();
    });

    it('should handle very small decimal numbers', () => {
      render(<MetricCard label="Rate" value={0.00001} />);
      // Very small decimals are formatted by toLocaleString which may round to 0
      expect(screen.getByText(/^0/)).toBeInTheDocument();
    });

    it('should handle empty string value', () => {
      render(<MetricCard label="Status" value="" />);
      expect(screen.getByText('Status')).toBeInTheDocument();
    });

    it('should handle trend of exactly 100%', () => {
      render(<MetricCard label="Growth" value={1000} trend={100} />);
      expect(screen.getByText('+100.0%')).toBeInTheDocument();
    });

    it('should handle trend of exactly -100%', () => {
      render(<MetricCard label="Decline" value={1000} trend={-100} />);
      expect(screen.getByText('-100.0%')).toBeInTheDocument();
    });

    it('should handle null trend as undefined', () => {
      render(<MetricCard label="Test" value={100} trend={null as any} />);
      expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    });
  });

  describe('Integration', () => {
    it('should render with all features combined', () => {
      render(
        <MetricCard
          label="Total Revenue"
          value={45231}
          trend={12.5}
          trendLabel="vs last month"
          icon={DollarSign}
          formatValue={(v) => `$${v.toLocaleString()}`}
          colorScheme="success"
          className="custom-card"
        />
      );

      expect(screen.getByText('Total Revenue')).toBeInTheDocument();
      expect(screen.getByText('$45,231')).toBeInTheDocument();
      expect(screen.getByText('+12.5%')).toBeInTheDocument();
      expect(screen.getByText('vs last month')).toBeInTheDocument();
    });

    it('should work with dynamic value updates', () => {
      const { rerender } = render(<MetricCard label="Count" value={10} />);
      expect(screen.getByText('10')).toBeInTheDocument();

      rerender(<MetricCard label="Count" value={20} />);
      expect(screen.getByText('20')).toBeInTheDocument();

      rerender(<MetricCard label="Count" value={30} />);
      expect(screen.getByText('30')).toBeInTheDocument();
    });

    it('should work with dynamic trend updates', () => {
      const { rerender } = render(
        <MetricCard label="Growth" value={100} trend={5} />
      );
      expect(screen.getByText('+5.0%')).toBeInTheDocument();

      rerender(<MetricCard label="Growth" value={100} trend={-3} />);
      expect(screen.getByText('-3.0%')).toBeInTheDocument();

      rerender(<MetricCard label="Growth" value={100} trend={0} />);
      expect(screen.getByText('0.0%')).toBeInTheDocument();
    });
  });
});
