import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from '@jest/globals';
import TrendChart, {
  TrendDataPoint,
} from '@/components/analytics/charts/TrendChart';

// Mock recharts to avoid rendering issues in test environment
jest.mock('recharts', () => ({
  LineChart: ({ children, data }: any) => (
    <div data-testid="line-chart" data-points={data?.length}>
      {children}
    </div>
  ),
  Line: ({ dataKey, stroke, strokeWidth }: any) => (
    <div
      data-testid="line"
      data-key={dataKey}
      data-color={stroke}
      data-width={strokeWidth}
    />
  ),
  XAxis: ({ dataKey }: any) => <div data-testid="x-axis" data-key={dataKey} />,
  YAxis: ({ tickFormatter }: any) => (
    <div data-testid="y-axis" data-formatter={!!tickFormatter} />
  ),
  CartesianGrid: () => <div data-testid="grid" />,
  Tooltip: ({ content }: any) => <div data-testid="tooltip">{content}</div>,
  ResponsiveContainer: ({ children, height }: any) => (
    <div data-testid="responsive-container" data-height={height}>
      {children}
    </div>
  ),
  Legend: () => <div data-testid="legend" />,
}));

const mockData: TrendDataPoint[] = [
  { date: 'Jan', value: 100 },
  { date: 'Feb', value: 150 },
  { date: 'Mar', value: 180 },
  { date: 'Apr', value: 220 },
  { date: 'May', value: 250 },
];

const decreasingData: TrendDataPoint[] = [
  { date: 'Jan', value: 250 },
  { date: 'Feb', value: 220 },
  { date: 'Mar', value: 180 },
  { date: 'Apr', value: 150 },
  { date: 'May', value: 100 },
];

describe('TrendChart', () => {
  describe('Rendering - Basic Structure', () => {
    it('should render chart container', () => {
      render(<TrendChart data={mockData} dataKey="value" />);

      expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    });

    it('should render responsive container', () => {
      render(<TrendChart data={mockData} dataKey="value" />);

      expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    });

    it('should render line element', () => {
      render(<TrendChart data={mockData} dataKey="value" />);

      expect(screen.getByTestId('line')).toBeInTheDocument();
    });

    it('should render X and Y axes', () => {
      render(<TrendChart data={mockData} dataKey="value" />);

      expect(screen.getByTestId('x-axis')).toBeInTheDocument();
      expect(screen.getByTestId('y-axis')).toBeInTheDocument();
    });

    it('should render grid', () => {
      render(<TrendChart data={mockData} dataKey="value" />);

      expect(screen.getByTestId('grid')).toBeInTheDocument();
    });

    it('should render tooltip', () => {
      render(<TrendChart data={mockData} dataKey="value" />);

      expect(screen.getByTestId('tooltip')).toBeInTheDocument();
    });

    it('should render with custom className', () => {
      const { container } = render(
        <TrendChart
          data={mockData}
          dataKey="value"
          className="custom-chart"
        />
      );

      expect(container.querySelector('.custom-chart')).toBeInTheDocument();
    });
  });

  describe('Title and Description', () => {
    it('should render title when provided', () => {
      render(
        <TrendChart
          data={mockData}
          dataKey="value"
          title="Revenue Trend"
        />
      );

      expect(screen.getByText('Revenue Trend')).toBeInTheDocument();
    });

    it('should render description when provided', () => {
      render(
        <TrendChart
          data={mockData}
          dataKey="value"
          description="Monthly revenue growth"
        />
      );

      expect(screen.getByText('Monthly revenue growth')).toBeInTheDocument();
    });

    it('should render both title and description', () => {
      render(
        <TrendChart
          data={mockData}
          dataKey="value"
          title="Revenue Trend"
          description="Monthly revenue growth"
        />
      );

      expect(screen.getByText('Revenue Trend')).toBeInTheDocument();
      expect(screen.getByText('Monthly revenue growth')).toBeInTheDocument();
    });

    it('should not render header when no title or description', () => {
      const { container } = render(
        <TrendChart data={mockData} dataKey="value" />
      );

      // Header should not be present
      expect(container.querySelector('.pb-3')).not.toBeInTheDocument();
    });
  });

  describe('Data Display', () => {
    it('should pass data to LineChart', () => {
      render(<TrendChart data={mockData} dataKey="value" />);

      const chart = screen.getByTestId('line-chart');
      expect(chart).toHaveAttribute('data-points', '5');
    });

    it('should use correct dataKey for line', () => {
      render(<TrendChart data={mockData} dataKey="value" />);

      const line = screen.getByTestId('line');
      expect(line).toHaveAttribute('data-key', 'value');
    });

    it('should use default xAxisKey', () => {
      render(<TrendChart data={mockData} dataKey="value" />);

      const xAxis = screen.getByTestId('x-axis');
      expect(xAxis).toHaveAttribute('data-key', 'date');
    });

    it('should use custom xAxisKey when provided', () => {
      const customData = [
        { month: 'Jan', revenue: 100 },
        { month: 'Feb', revenue: 150 },
      ];

      render(
        <TrendChart
          data={customData as any}
          dataKey="revenue"
          xAxisKey="month"
        />
      );

      const xAxis = screen.getByTestId('x-axis');
      expect(xAxis).toHaveAttribute('data-key', 'month');
    });

    it('should handle empty data array', () => {
      render(<TrendChart data={[]} dataKey="value" />);

      const chart = screen.getByTestId('line-chart');
      expect(chart).toHaveAttribute('data-points', '0');
    });

    it('should handle single data point', () => {
      render(<TrendChart data={[mockData[0]]} dataKey="value" />);

      const chart = screen.getByTestId('line-chart');
      expect(chart).toHaveAttribute('data-points', '1');
    });
  });

  describe('Trend Calculation', () => {
    it('should show positive trend for increasing data', () => {
      render(
        <TrendChart
          data={mockData}
          dataKey="value"
          title="Test"
          showTrend
        />
      );

      // Trend: (250 - 100) / 100 = 150%
      expect(screen.getByText('+150.0%')).toBeInTheDocument();
    });

    it('should show negative trend for decreasing data', () => {
      render(
        <TrendChart
          data={decreasingData}
          dataKey="value"
          title="Test"
          showTrend
        />
      );

      // Trend: (100 - 250) / 250 = -60%
      expect(screen.getByText('-60.0%')).toBeInTheDocument();
    });

    it('should show TrendingUp icon for positive trend', () => {
      const { container } = render(
        <TrendChart
          data={mockData}
          dataKey="value"
          title="Test"
          showTrend
        />
      );

      const trendIcon = container.querySelector('.text-green-600');
      expect(trendIcon).toBeInTheDocument();
    });

    it('should show TrendingDown icon for negative trend', () => {
      const { container } = render(
        <TrendChart
          data={decreasingData}
          dataKey="value"
          title="Test"
          showTrend
        />
      );

      const trendIcon = container.querySelector('.text-red-600');
      expect(trendIcon).toBeInTheDocument();
    });

    it('should not show trend when showTrend is false', () => {
      render(
        <TrendChart
          data={mockData}
          dataKey="value"
          title="Test"
          showTrend={false}
        />
      );

      expect(screen.queryByText(/150.0%/)).not.toBeInTheDocument();
    });

    it('should not show trend when data has less than 2 points', () => {
      render(
        <TrendChart
          data={[mockData[0]]}
          dataKey="value"
          title="Test"
          showTrend
        />
      );

      expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    });

    it('should not show trend when first value is 0', () => {
      const zeroStartData = [
        { date: 'Jan', value: 0 },
        { date: 'Feb', value: 100 },
      ];

      render(
        <TrendChart
          data={zeroStartData}
          dataKey="value"
          title="Test"
          showTrend
        />
      );

      expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    });

    it('should handle zero trend (no change)', () => {
      const flatData = [
        { date: 'Jan', value: 100 },
        { date: 'Feb', value: 100 },
      ];

      render(
        <TrendChart
          data={flatData}
          dataKey="value"
          title="Test"
          showTrend
        />
      );

      expect(screen.getByText('0.0%')).toBeInTheDocument();
    });
  });

  describe('Color Customization', () => {
    it('should use default color', () => {
      render(<TrendChart data={mockData} dataKey="value" />);

      const line = screen.getByTestId('line');
      expect(line).toHaveAttribute('data-color', '#3b82f6');
    });

    it('should use custom color when provided', () => {
      render(
        <TrendChart
          data={mockData}
          dataKey="value"
          color="#10b981"
        />
      );

      const line = screen.getByTestId('line');
      expect(line).toHaveAttribute('data-color', '#10b981');
    });

    it('should use custom color with hex format', () => {
      render(
        <TrendChart
          data={mockData}
          dataKey="value"
          color="#ff5733"
        />
      );

      const line = screen.getByTestId('line');
      expect(line).toHaveAttribute('data-color', '#ff5733');
    });
  });

  describe('Height Customization', () => {
    it('should use default height', () => {
      render(<TrendChart data={mockData} dataKey="value" />);

      const container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '300');
    });

    it('should use custom height when provided', () => {
      render(
        <TrendChart
          data={mockData}
          dataKey="value"
          height={400}
        />
      );

      const container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '400');
    });

    it('should handle small height', () => {
      render(
        <TrendChart
          data={mockData}
          dataKey="value"
          height={200}
        />
      );

      const container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '200');
    });
  });

  describe('Value Formatting', () => {
    it('should apply custom formatValue to Y-axis', () => {
      const formatValue = (value: number) => `$${value}`;

      render(
        <TrendChart
          data={mockData}
          dataKey="value"
          formatValue={formatValue}
        />
      );

      const yAxis = screen.getByTestId('y-axis');
      expect(yAxis).toHaveAttribute('data-formatter', 'true');
    });

    it('should work without formatValue', () => {
      render(<TrendChart data={mockData} dataKey="value" />);

      const yAxis = screen.getByTestId('y-axis');
      expect(yAxis).toBeInTheDocument();
    });
  });

  describe('Line Styling', () => {
    it('should apply stroke width', () => {
      render(<TrendChart data={mockData} dataKey="value" />);

      const line = screen.getByTestId('line');
      expect(line).toHaveAttribute('data-width', '2');
    });
  });

  describe('Edge Cases', () => {
    it('should handle negative values', () => {
      const negativeData = [
        { date: 'Jan', value: -100 },
        { date: 'Feb', value: -50 },
        { date: 'Mar', value: -25 },
      ];

      render(<TrendChart data={negativeData} dataKey="value" />);

      const chart = screen.getByTestId('line-chart');
      expect(chart).toBeInTheDocument();
    });

    it('should handle very large values', () => {
      const largeData = [
        { date: 'Jan', value: 1000000 },
        { date: 'Feb', value: 2000000 },
      ];

      render(<TrendChart data={largeData} dataKey="value" />);

      const chart = screen.getByTestId('line-chart');
      expect(chart).toBeInTheDocument();
    });

    it('should handle decimal values', () => {
      const decimalData = [
        { date: 'Jan', value: 10.5 },
        { date: 'Feb', value: 15.75 },
        { date: 'Mar', value: 20.25 },
      ];

      render(<TrendChart data={decimalData} dataKey="value" />);

      const chart = screen.getByTestId('line-chart');
      expect(chart).toBeInTheDocument();
    });

    it('should handle many data points', () => {
      const manyPoints = Array.from({ length: 100 }, (_, i) => ({
        date: `Day ${i + 1}`,
        value: i * 10,
      }));

      render(<TrendChart data={manyPoints} dataKey="value" />);

      const chart = screen.getByTestId('line-chart');
      expect(chart).toHaveAttribute('data-points', '100');
    });

    it('should handle data with additional properties', () => {
      const complexData = [
        { date: 'Jan', value: 100, label: 'January', extra: 'info' },
        { date: 'Feb', value: 150, label: 'February', extra: 'info' },
      ];

      render(<TrendChart data={complexData} dataKey="value" />);

      const chart = screen.getByTestId('line-chart');
      expect(chart).toBeInTheDocument();
    });

    it('should not crash with undefined className', () => {
      const { container } = render(
        <TrendChart
          data={mockData}
          dataKey="value"
          className={undefined}
        />
      );

      expect(container.firstChild).toBeInTheDocument();
    });

    it('should not crash with empty title', () => {
      render(
        <TrendChart
          data={mockData}
          dataKey="value"
          title=""
        />
      );

      expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    });
  });

  describe('Integration Scenarios', () => {
    it('should work with all props combined', () => {
      render(
        <TrendChart
          data={mockData}
          dataKey="value"
          xAxisKey="date"
          title="Complete Chart"
          description="With all features"
          color="#10b981"
          showTrend
          formatValue={(v) => `$${v}`}
          height={400}
          className="custom-class"
        />
      );

      expect(screen.getByText('Complete Chart')).toBeInTheDocument();
      expect(screen.getByText('With all features')).toBeInTheDocument();
      expect(screen.getByText('+150.0%')).toBeInTheDocument();
    });

    it('should work with minimal props', () => {
      render(<TrendChart data={mockData} dataKey="value" />);

      expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    });
  });

  describe('Dynamic Updates', () => {
    it('should update when data changes', () => {
      const { rerender } = render(
        <TrendChart data={mockData} dataKey="value" title="Test" />
      );

      expect(screen.getByText('+150.0%')).toBeInTheDocument();

      rerender(
        <TrendChart data={decreasingData} dataKey="value" title="Test" />
      );

      expect(screen.getByText('-60.0%')).toBeInTheDocument();
    });

    it('should update when dataKey changes', () => {
      const multiKeyData = [
        { date: 'Jan', revenue: 100, bookings: 50 },
        { date: 'Feb', revenue: 150, bookings: 75 },
      ];

      const { rerender } = render(
        <TrendChart data={multiKeyData as any} dataKey="revenue" />
      );

      let line = screen.getByTestId('line');
      expect(line).toHaveAttribute('data-key', 'revenue');

      rerender(
        <TrendChart data={multiKeyData as any} dataKey="bookings" />
      );

      line = screen.getByTestId('line');
      expect(line).toHaveAttribute('data-key', 'bookings');
    });

    it('should update when color changes', () => {
      const { rerender } = render(
        <TrendChart data={mockData} dataKey="value" color="#3b82f6" />
      );

      let line = screen.getByTestId('line');
      expect(line).toHaveAttribute('data-color', '#3b82f6');

      rerender(
        <TrendChart data={mockData} dataKey="value" color="#10b981" />
      );

      line = screen.getByTestId('line');
      expect(line).toHaveAttribute('data-color', '#10b981');
    });

    it('should update when height changes', () => {
      const { rerender } = render(
        <TrendChart data={mockData} dataKey="value" height={300} />
      );

      let container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '300');

      rerender(
        <TrendChart data={mockData} dataKey="value" height={500} />
      );

      container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '500');
    });

    it('should update when showTrend toggles', () => {
      const { rerender } = render(
        <TrendChart
          data={mockData}
          dataKey="value"
          title="Test"
          showTrend={true}
        />
      );

      expect(screen.getByText('+150.0%')).toBeInTheDocument();

      rerender(
        <TrendChart
          data={mockData}
          dataKey="value"
          title="Test"
          showTrend={false}
        />
      );

      expect(screen.queryByText('+150.0%')).not.toBeInTheDocument();
    });
  });
});
