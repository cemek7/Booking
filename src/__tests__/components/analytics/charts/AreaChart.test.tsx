import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from '@jest/globals';
import AreaChart, {
  AreaDataPoint,
} from '@/components/analytics/charts/AreaChart';

// Mock recharts components
jest.mock('recharts', () => ({
  AreaChart: ({ children, data }: any) => (
    <div data-testid="area-chart" data-points={data?.length}>
      {children}
    </div>
  ),
  Area: ({ dataKey, stroke, strokeWidth, stackId, fill }: any) => (
    <div
      data-testid={`area-${dataKey}`}
      data-key={dataKey}
      data-stroke={stroke}
      data-width={strokeWidth}
      data-stacked={!!stackId}
      data-fill={fill}
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

const mockData: AreaDataPoint[] = [
  { date: '2024-01', revenue: 4000, expenses: 2400 },
  { date: '2024-02', revenue: 3000, expenses: 1398 },
  { date: '2024-03', revenue: 2000, expenses: 9800 },
  { date: '2024-04', revenue: 2780, expenses: 3908 },
];

describe('AreaChart', () => {
  describe('Rendering - Basic Structure', () => {
    it('should render area chart container', () => {
      render(<AreaChart data={mockData} dataKeys={['revenue']} />);

      expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    });

    it('should render responsive container', () => {
      render(<AreaChart data={mockData} dataKeys={['revenue']} />);

      expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    });

    it('should render grid', () => {
      render(<AreaChart data={mockData} dataKeys={['revenue']} />);

      expect(screen.getByTestId('grid')).toBeInTheDocument();
    });

    it('should render X and Y axes', () => {
      render(<AreaChart data={mockData} dataKeys={['revenue']} />);

      expect(screen.getByTestId('x-axis')).toBeInTheDocument();
      expect(screen.getByTestId('y-axis')).toBeInTheDocument();
    });

    it('should render tooltip', () => {
      render(<AreaChart data={mockData} dataKeys={['revenue']} />);

      expect(screen.getByTestId('tooltip')).toBeInTheDocument();
    });

    it('should render with custom className', () => {
      const { container } = render(
        <AreaChart
          data={mockData}
          dataKeys={['revenue']}
          className="custom-area-chart"
        />
      );

      expect(container.querySelector('.custom-area-chart')).toBeInTheDocument();
    });
  });

  describe('Title and Description', () => {
    it('should render title when provided', () => {
      render(
        <AreaChart
          data={mockData}
          dataKeys={['revenue']}
          title="Revenue Trends"
        />
      );

      expect(screen.getByText('Revenue Trends')).toBeInTheDocument();
    });

    it('should render description when provided', () => {
      render(
        <AreaChart
          data={mockData}
          dataKeys={['revenue']}
          description="Monthly revenue analysis"
        />
      );

      expect(screen.getByText('Monthly revenue analysis')).toBeInTheDocument();
    });

    it('should render both title and description', () => {
      render(
        <AreaChart
          data={mockData}
          dataKeys={['revenue']}
          title="Revenue Trends"
          description="Monthly revenue analysis"
        />
      );

      expect(screen.getByText('Revenue Trends')).toBeInTheDocument();
      expect(screen.getByText('Monthly revenue analysis')).toBeInTheDocument();
    });

    it('should not render header when no title or description', () => {
      const { container } = render(
        <AreaChart data={mockData} dataKeys={['revenue']} />
      );

      expect(container.querySelector('.pb-3')).not.toBeInTheDocument();
    });
  });

  describe('Data Display', () => {
    it('should pass data to AreaChart', () => {
      render(<AreaChart data={mockData} dataKeys={['revenue']} />);

      const chart = screen.getByTestId('area-chart');
      expect(chart).toHaveAttribute('data-points', '4');
    });

    it('should render single data key', () => {
      render(<AreaChart data={mockData} dataKeys={['revenue']} />);

      expect(screen.getByTestId('area-revenue')).toBeInTheDocument();
    });

    it('should render multiple data keys', () => {
      render(<AreaChart data={mockData} dataKeys={['revenue', 'expenses']} />);

      expect(screen.getByTestId('area-revenue')).toBeInTheDocument();
      expect(screen.getByTestId('area-expenses')).toBeInTheDocument();
    });

    it('should render three data keys', () => {
      const dataWithThree = mockData.map((item) => ({
        ...item,
        profit: 1000,
      }));

      render(
        <AreaChart
          data={dataWithThree}
          dataKeys={['revenue', 'expenses', 'profit']}
        />
      );

      expect(screen.getByTestId('area-revenue')).toBeInTheDocument();
      expect(screen.getByTestId('area-expenses')).toBeInTheDocument();
      expect(screen.getByTestId('area-profit')).toBeInTheDocument();
    });

    it('should use default xAxisKey', () => {
      render(<AreaChart data={mockData} dataKeys={['revenue']} />);

      const xAxis = screen.getByTestId('x-axis');
      expect(xAxis).toHaveAttribute('data-key', 'date');
    });

    it('should use custom xAxisKey when provided', () => {
      const customData = [
        { month: 'Jan', value: 100 },
        { month: 'Feb', value: 150 },
      ];

      render(
        <AreaChart
          data={customData as any}
          dataKeys={['value']}
          xAxisKey="month"
        />
      );

      const xAxis = screen.getByTestId('x-axis');
      expect(xAxis).toHaveAttribute('data-key', 'month');
    });

    it('should handle empty data array', () => {
      render(<AreaChart data={[]} dataKeys={['revenue']} />);

      const chart = screen.getByTestId('area-chart');
      expect(chart).toHaveAttribute('data-points', '0');
    });

    it('should handle single data point', () => {
      render(<AreaChart data={[mockData[0]]} dataKeys={['revenue']} />);

      const chart = screen.getByTestId('area-chart');
      expect(chart).toHaveAttribute('data-points', '1');
    });
  });

  describe('Area Colors', () => {
    it('should use default colors', () => {
      render(<AreaChart data={mockData} dataKeys={['revenue', 'expenses']} />);

      const revenueArea = screen.getByTestId('area-revenue');
      const expensesArea = screen.getByTestId('area-expenses');

      expect(revenueArea).toHaveAttribute('data-stroke', '#3b82f6');
      expect(expensesArea).toHaveAttribute('data-stroke', '#10b981');
    });

    it('should use custom colors', () => {
      render(
        <AreaChart
          data={mockData}
          dataKeys={['revenue', 'expenses']}
          colors={['#ff0000', '#00ff00']}
        />
      );

      const revenueArea = screen.getByTestId('area-revenue');
      const expensesArea = screen.getByTestId('area-expenses');

      expect(revenueArea).toHaveAttribute('data-stroke', '#ff0000');
      expect(expensesArea).toHaveAttribute('data-stroke', '#00ff00');
    });

    it('should cycle through colors when more keys than colors', () => {
      render(
        <AreaChart
          data={mockData}
          dataKeys={['revenue', 'expenses', 'profit']}
          colors={['#ff0000', '#00ff00']}
        />
      );

      const revenueArea = screen.getByTestId('area-revenue');
      const expensesArea = screen.getByTestId('area-expenses');
      const profitArea = screen.getByTestId('area-profit');

      expect(revenueArea).toHaveAttribute('data-stroke', '#ff0000');
      expect(expensesArea).toHaveAttribute('data-stroke', '#00ff00');
      expect(profitArea).toHaveAttribute('data-stroke', '#ff0000'); // Cycles back
    });

    it('should apply stroke width', () => {
      render(<AreaChart data={mockData} dataKeys={['revenue']} />);

      const area = screen.getByTestId('area-revenue');
      expect(area).toHaveAttribute('data-width', '2');
    });
  });

  describe('Gradient Fills', () => {
    it('should use gradient fill for areas', () => {
      render(<AreaChart data={mockData} dataKeys={['revenue']} />);

      const area = screen.getByTestId('area-revenue');
      expect(area).toHaveAttribute('data-fill', 'url(#gradient-revenue)');
    });

    it('should use unique gradients for each data key', () => {
      render(<AreaChart data={mockData} dataKeys={['revenue', 'expenses']} />);

      const revenueArea = screen.getByTestId('area-revenue');
      const expensesArea = screen.getByTestId('area-expenses');

      expect(revenueArea).toHaveAttribute('data-fill', 'url(#gradient-revenue)');
      expect(expensesArea).toHaveAttribute('data-fill', 'url(#gradient-expenses)');
    });
  });

  describe('Stacked Areas', () => {
    it('should not stack by default', () => {
      render(<AreaChart data={mockData} dataKeys={['revenue', 'expenses']} />);

      const revenueArea = screen.getByTestId('area-revenue');
      const expensesArea = screen.getByTestId('area-expenses');

      expect(revenueArea).toHaveAttribute('data-stacked', 'false');
      expect(expensesArea).toHaveAttribute('data-stacked', 'false');
    });

    it('should stack areas when stacked=true', () => {
      render(
        <AreaChart
          data={mockData}
          dataKeys={['revenue', 'expenses']}
          stacked
        />
      );

      const revenueArea = screen.getByTestId('area-revenue');
      const expensesArea = screen.getByTestId('area-expenses');

      expect(revenueArea).toHaveAttribute('data-stacked', 'true');
      expect(expensesArea).toHaveAttribute('data-stacked', 'true');
    });

    it('should stack multiple areas', () => {
      const dataWithThree = mockData.map((item) => ({
        ...item,
        profit: 1000,
      }));

      render(
        <AreaChart
          data={dataWithThree}
          dataKeys={['revenue', 'expenses', 'profit']}
          stacked
        />
      );

      expect(screen.getByTestId('area-revenue')).toHaveAttribute(
        'data-stacked',
        'true'
      );
      expect(screen.getByTestId('area-expenses')).toHaveAttribute(
        'data-stacked',
        'true'
      );
      expect(screen.getByTestId('area-profit')).toHaveAttribute(
        'data-stacked',
        'true'
      );
    });
  });

  describe('Legend', () => {
    it('should show legend by default', () => {
      render(<AreaChart data={mockData} dataKeys={['revenue']} />);

      expect(screen.getByTestId('legend')).toBeInTheDocument();
    });

    it('should hide legend when showLegend=false', () => {
      render(
        <AreaChart
          data={mockData}
          dataKeys={['revenue']}
          showLegend={false}
        />
      );

      expect(screen.queryByTestId('legend')).not.toBeInTheDocument();
    });

    it('should show legend when showLegend=true explicitly', () => {
      render(
        <AreaChart
          data={mockData}
          dataKeys={['revenue']}
          showLegend={true}
        />
      );

      expect(screen.getByTestId('legend')).toBeInTheDocument();
    });
  });

  describe('Height Customization', () => {
    it('should use default height', () => {
      render(<AreaChart data={mockData} dataKeys={['revenue']} />);

      const container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '300');
    });

    it('should use custom height', () => {
      render(
        <AreaChart data={mockData} dataKeys={['revenue']} height={400} />
      );

      const container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '400');
    });

    it('should handle small height', () => {
      render(
        <AreaChart data={mockData} dataKeys={['revenue']} height={200} />
      );

      const container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '200');
    });

    it('should handle large height', () => {
      render(
        <AreaChart data={mockData} dataKeys={['revenue']} height={600} />
      );

      const container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '600');
    });
  });

  describe('Value Formatting', () => {
    it('should apply formatValue to Y-axis', () => {
      const formatValue = (value: number) => `$${value}`;

      render(
        <AreaChart
          data={mockData}
          dataKeys={['revenue']}
          formatValue={formatValue}
        />
      );

      const yAxis = screen.getByTestId('y-axis');
      expect(yAxis).toHaveAttribute('data-formatter', 'true');
    });

    it('should work without formatValue', () => {
      render(<AreaChart data={mockData} dataKeys={['revenue']} />);

      const yAxis = screen.getByTestId('y-axis');
      expect(yAxis).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle negative values', () => {
      const negativeData = [
        { date: '2024-01', revenue: -100, expenses: 200 },
        { date: '2024-02', revenue: 150, expenses: -50 },
      ];

      render(
        <AreaChart data={negativeData} dataKeys={['revenue', 'expenses']} />
      );

      expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    });

    it('should handle zero values', () => {
      const zeroData = [
        { date: '2024-01', revenue: 0, expenses: 200 },
        { date: '2024-02', revenue: 150, expenses: 0 },
      ];

      render(
        <AreaChart data={zeroData} dataKeys={['revenue', 'expenses']} />
      );

      expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    });

    it('should handle very large values', () => {
      const largeData = [
        { date: '2024-01', revenue: 1000000, expenses: 500000 },
        { date: '2024-02', revenue: 2000000, expenses: 1000000 },
      ];

      render(
        <AreaChart data={largeData} dataKeys={['revenue', 'expenses']} />
      );

      expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    });

    it('should handle decimal values', () => {
      const decimalData = [
        { date: '2024-01', revenue: 100.5, expenses: 50.25 },
        { date: '2024-02', revenue: 150.75, expenses: 75.5 },
      ];

      render(
        <AreaChart data={decimalData} dataKeys={['revenue', 'expenses']} />
      );

      expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    });

    it('should handle many data points', () => {
      const manyPoints = Array.from({ length: 50 }, (_, i) => ({
        date: `2024-${i + 1}`,
        value: i * 100,
      }));

      render(<AreaChart data={manyPoints} dataKeys={['value']} />);

      const chart = screen.getByTestId('area-chart');
      expect(chart).toHaveAttribute('data-points', '50');
    });

    it('should handle many data keys', () => {
      const multiKeyData = [
        {
          date: '2024-01',
          a: 100,
          b: 200,
          c: 300,
          d: 400,
          e: 500,
        },
      ];

      render(
        <AreaChart
          data={multiKeyData}
          dataKeys={['a', 'b', 'c', 'd', 'e']}
        />
      );

      expect(screen.getByTestId('area-a')).toBeInTheDocument();
      expect(screen.getByTestId('area-e')).toBeInTheDocument();
    });

    it('should not crash with undefined className', () => {
      const { container } = render(
        <AreaChart
          data={mockData}
          dataKeys={['revenue']}
          className={undefined}
        />
      );

      expect(container.firstChild).toBeInTheDocument();
    });

    it('should not crash with empty title', () => {
      render(
        <AreaChart
          data={mockData}
          dataKeys={['revenue']}
          title=""
        />
      );

      expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    });

    it('should handle data with additional properties', () => {
      const complexData = [
        {
          date: '2024-01',
          revenue: 100,
          expenses: 50,
          extra: 'info',
          label: 'January',
        },
      ];

      render(
        <AreaChart data={complexData} dataKeys={['revenue', 'expenses']} />
      );

      expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    });
  });

  describe('Integration Scenarios', () => {
    it('should work with all props combined', () => {
      render(
        <AreaChart
          data={mockData}
          dataKeys={['revenue', 'expenses']}
          xAxisKey="date"
          title="Complete Chart"
          description="With all features"
          colors={['#ff0000', '#00ff00']}
          stacked
          formatValue={(v) => `$${v}`}
          height={400}
          showLegend
          className="custom-class"
        />
      );

      expect(screen.getByText('Complete Chart')).toBeInTheDocument();
      expect(screen.getByText('With all features')).toBeInTheDocument();
      expect(screen.getByTestId('area-revenue')).toHaveAttribute(
        'data-stroke',
        '#ff0000'
      );
      expect(screen.getByTestId('area-revenue')).toHaveAttribute(
        'data-stacked',
        'true'
      );
    });

    it('should work with minimal props', () => {
      render(<AreaChart data={mockData} dataKeys={['revenue']} />);

      expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    });

    it('should combine stacked and multiple data keys', () => {
      render(
        <AreaChart
          data={mockData}
          dataKeys={['revenue', 'expenses']}
          stacked
        />
      );

      const revenueArea = screen.getByTestId('area-revenue');
      expect(revenueArea).toHaveAttribute('data-stacked', 'true');
    });
  });

  describe('Dynamic Updates', () => {
    it('should update when data changes', () => {
      const { rerender } = render(
        <AreaChart data={mockData} dataKeys={['revenue']} />
      );

      const chart = screen.getByTestId('area-chart');
      expect(chart).toHaveAttribute('data-points', '4');

      const newData = [{ date: '2024-05', revenue: 5000 }];

      rerender(<AreaChart data={newData} dataKeys={['revenue']} />);

      expect(chart).toHaveAttribute('data-points', '1');
    });

    it('should update when dataKeys change', () => {
      const { rerender } = render(
        <AreaChart data={mockData} dataKeys={['revenue']} />
      );

      expect(screen.getByTestId('area-revenue')).toBeInTheDocument();
      expect(screen.queryByTestId('area-expenses')).not.toBeInTheDocument();

      rerender(
        <AreaChart data={mockData} dataKeys={['revenue', 'expenses']} />
      );

      expect(screen.getByTestId('area-revenue')).toBeInTheDocument();
      expect(screen.getByTestId('area-expenses')).toBeInTheDocument();
    });

    it('should update when colors change', () => {
      const { rerender } = render(
        <AreaChart
          data={mockData}
          dataKeys={['revenue']}
          colors={['#ff0000']}
        />
      );

      let area = screen.getByTestId('area-revenue');
      expect(area).toHaveAttribute('data-stroke', '#ff0000');

      rerender(
        <AreaChart
          data={mockData}
          dataKeys={['revenue']}
          colors={['#00ff00']}
        />
      );

      area = screen.getByTestId('area-revenue');
      expect(area).toHaveAttribute('data-stroke', '#00ff00');
    });

    it('should update when stacked prop changes', () => {
      const { rerender } = render(
        <AreaChart
          data={mockData}
          dataKeys={['revenue']}
          stacked={false}
        />
      );

      let area = screen.getByTestId('area-revenue');
      expect(area).toHaveAttribute('data-stacked', 'false');

      rerender(
        <AreaChart
          data={mockData}
          dataKeys={['revenue']}
          stacked={true}
        />
      );

      area = screen.getByTestId('area-revenue');
      expect(area).toHaveAttribute('data-stacked', 'true');
    });

    it('should update when showLegend changes', () => {
      const { rerender } = render(
        <AreaChart
          data={mockData}
          dataKeys={['revenue']}
          showLegend={true}
        />
      );

      expect(screen.getByTestId('legend')).toBeInTheDocument();

      rerender(
        <AreaChart
          data={mockData}
          dataKeys={['revenue']}
          showLegend={false}
        />
      );

      expect(screen.queryByTestId('legend')).not.toBeInTheDocument();
    });

    it('should update when xAxisKey changes', () => {
      const multiKeyData = [
        { date: 'Jan', month: 'January', value: 100 },
        { date: 'Feb', month: 'February', value: 200 },
      ];

      const { rerender } = render(
        <AreaChart data={multiKeyData as any} dataKeys={['value']} xAxisKey="date" />
      );

      let xAxis = screen.getByTestId('x-axis');
      expect(xAxis).toHaveAttribute('data-key', 'date');

      rerender(
        <AreaChart data={multiKeyData as any} dataKeys={['value']} xAxisKey="month" />
      );

      xAxis = screen.getByTestId('x-axis');
      expect(xAxis).toHaveAttribute('data-key', 'month');
    });
  });
});
