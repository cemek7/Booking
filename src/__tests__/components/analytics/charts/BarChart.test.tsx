import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from '@jest/globals';
import BarChart, { BarDataPoint } from '@/components/analytics/charts/BarChart';

// Mock recharts components
jest.mock('recharts', () => ({
  BarChart: ({ children, data, layout }: any) => (
    <div
      data-testid="bar-chart"
      data-points={data?.length}
      data-layout={layout}
    >
      {children}
    </div>
  ),
  Bar: ({ dataKey, fill, stackId }: any) => (
    <div
      data-testid={`bar-${dataKey}`}
      data-key={dataKey}
      data-fill={fill}
      data-stacked={!!stackId}
    />
  ),
  XAxis: ({ dataKey, type, tickFormatter }: any) => (
    <div
      data-testid="x-axis"
      data-key={dataKey}
      data-type={type}
      data-formatter={!!tickFormatter}
    />
  ),
  YAxis: ({ dataKey, type, tickFormatter }: any) => (
    <div
      data-testid="y-axis"
      data-key={dataKey}
      data-type={type}
      data-formatter={!!tickFormatter}
    />
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

const mockData: BarDataPoint[] = [
  { name: 'Jan', revenue: 4000, costs: 2400 },
  { name: 'Feb', revenue: 3000, costs: 1398 },
  { name: 'Mar', revenue: 2000, costs: 9800 },
  { name: 'Apr', revenue: 2780, costs: 3908 },
];

describe('BarChart', () => {
  describe('Rendering - Basic Structure', () => {
    it('should render bar chart container', () => {
      render(
        <BarChart data={mockData} dataKeys={['revenue']} />
      );

      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('should render responsive container', () => {
      render(
        <BarChart data={mockData} dataKeys={['revenue']} />
      );

      expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    });

    it('should render grid', () => {
      render(
        <BarChart data={mockData} dataKeys={['revenue']} />
      );

      expect(screen.getByTestId('grid')).toBeInTheDocument();
    });

    it('should render X and Y axes', () => {
      render(
        <BarChart data={mockData} dataKeys={['revenue']} />
      );

      expect(screen.getByTestId('x-axis')).toBeInTheDocument();
      expect(screen.getByTestId('y-axis')).toBeInTheDocument();
    });

    it('should render tooltip', () => {
      render(
        <BarChart data={mockData} dataKeys={['revenue']} />
      );

      expect(screen.getByTestId('tooltip')).toBeInTheDocument();
    });

    it('should render with custom className', () => {
      const { container } = render(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          className="custom-bar-chart"
        />
      );

      expect(container.querySelector('.custom-bar-chart')).toBeInTheDocument();
    });
  });

  describe('Title and Description', () => {
    it('should render title when provided', () => {
      render(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          title="Revenue vs Costs"
        />
      );

      expect(screen.getByText('Revenue vs Costs')).toBeInTheDocument();
    });

    it('should render description when provided', () => {
      render(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          description="Monthly comparison"
        />
      );

      expect(screen.getByText('Monthly comparison')).toBeInTheDocument();
    });

    it('should render both title and description', () => {
      render(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          title="Revenue vs Costs"
          description="Monthly comparison"
        />
      );

      expect(screen.getByText('Revenue vs Costs')).toBeInTheDocument();
      expect(screen.getByText('Monthly comparison')).toBeInTheDocument();
    });

    it('should not render header when no title or description', () => {
      const { container } = render(
        <BarChart data={mockData} dataKeys={['revenue']} />
      );

      expect(container.querySelector('.pb-3')).not.toBeInTheDocument();
    });
  });

  describe('Data Display', () => {
    it('should pass data to BarChart', () => {
      render(
        <BarChart data={mockData} dataKeys={['revenue']} />
      );

      const chart = screen.getByTestId('bar-chart');
      expect(chart).toHaveAttribute('data-points', '4');
    });

    it('should render single data key', () => {
      render(
        <BarChart data={mockData} dataKeys={['revenue']} />
      );

      expect(screen.getByTestId('bar-revenue')).toBeInTheDocument();
    });

    it('should render multiple data keys', () => {
      render(
        <BarChart data={mockData} dataKeys={['revenue', 'costs']} />
      );

      expect(screen.getByTestId('bar-revenue')).toBeInTheDocument();
      expect(screen.getByTestId('bar-costs')).toBeInTheDocument();
    });

    it('should render three data keys', () => {
      const dataWithThree = mockData.map((item) => ({
        ...item,
        profit: 1000,
      }));

      render(
        <BarChart
          data={dataWithThree}
          dataKeys={['revenue', 'costs', 'profit']}
        />
      );

      expect(screen.getByTestId('bar-revenue')).toBeInTheDocument();
      expect(screen.getByTestId('bar-costs')).toBeInTheDocument();
      expect(screen.getByTestId('bar-profit')).toBeInTheDocument();
    });

    it('should handle empty data array', () => {
      render(
        <BarChart data={[]} dataKeys={['revenue']} />
      );

      const chart = screen.getByTestId('bar-chart');
      expect(chart).toHaveAttribute('data-points', '0');
    });

    it('should handle single data point', () => {
      render(
        <BarChart data={[mockData[0]]} dataKeys={['revenue']} />
      );

      const chart = screen.getByTestId('bar-chart');
      expect(chart).toHaveAttribute('data-points', '1');
    });
  });

  describe('Bar Colors', () => {
    it('should use default colors', () => {
      render(
        <BarChart data={mockData} dataKeys={['revenue', 'costs']} />
      );

      const revenueBar = screen.getByTestId('bar-revenue');
      const costsBar = screen.getByTestId('bar-costs');

      expect(revenueBar).toHaveAttribute('data-fill', '#3b82f6');
      expect(costsBar).toHaveAttribute('data-fill', '#10b981');
    });

    it('should use custom colors', () => {
      render(
        <BarChart
          data={mockData}
          dataKeys={['revenue', 'costs']}
          colors={['#ff0000', '#00ff00']}
        />
      );

      const revenueBar = screen.getByTestId('bar-revenue');
      const costsBar = screen.getByTestId('bar-costs');

      expect(revenueBar).toHaveAttribute('data-fill', '#ff0000');
      expect(costsBar).toHaveAttribute('data-fill', '#00ff00');
    });

    it('should cycle through colors when more keys than colors', () => {
      render(
        <BarChart
          data={mockData}
          dataKeys={['revenue', 'costs', 'profit']}
          colors={['#ff0000', '#00ff00']}
        />
      );

      const revenueBar = screen.getByTestId('bar-revenue');
      const costsBar = screen.getByTestId('bar-costs');
      const profitBar = screen.getByTestId('bar-profit');

      expect(revenueBar).toHaveAttribute('data-fill', '#ff0000');
      expect(costsBar).toHaveAttribute('data-fill', '#00ff00');
      expect(profitBar).toHaveAttribute('data-fill', '#ff0000'); // Cycles back
    });
  });

  describe('Stacked Bars', () => {
    it('should not stack by default', () => {
      render(
        <BarChart data={mockData} dataKeys={['revenue', 'costs']} />
      );

      const revenueBar = screen.getByTestId('bar-revenue');
      const costsBar = screen.getByTestId('bar-costs');

      expect(revenueBar).toHaveAttribute('data-stacked', 'false');
      expect(costsBar).toHaveAttribute('data-stacked', 'false');
    });

    it('should stack bars when stacked=true', () => {
      render(
        <BarChart
          data={mockData}
          dataKeys={['revenue', 'costs']}
          stacked
        />
      );

      const revenueBar = screen.getByTestId('bar-revenue');
      const costsBar = screen.getByTestId('bar-costs');

      expect(revenueBar).toHaveAttribute('data-stacked', 'true');
      expect(costsBar).toHaveAttribute('data-stacked', 'true');
    });

    it('should stack multiple bars', () => {
      const dataWithThree = mockData.map((item) => ({
        ...item,
        profit: 1000,
      }));

      render(
        <BarChart
          data={dataWithThree}
          dataKeys={['revenue', 'costs', 'profit']}
          stacked
        />
      );

      expect(screen.getByTestId('bar-revenue')).toHaveAttribute(
        'data-stacked',
        'true'
      );
      expect(screen.getByTestId('bar-costs')).toHaveAttribute(
        'data-stacked',
        'true'
      );
      expect(screen.getByTestId('bar-profit')).toHaveAttribute(
        'data-stacked',
        'true'
      );
    });
  });

  describe('Horizontal vs Vertical', () => {
    it('should render vertically by default', () => {
      render(
        <BarChart data={mockData} dataKeys={['revenue']} />
      );

      const chart = screen.getByTestId('bar-chart');
      expect(chart).toHaveAttribute('data-layout', 'horizontal');
    });

    it('should render horizontally when horizontal=true', () => {
      render(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          horizontal
        />
      );

      const chart = screen.getByTestId('bar-chart');
      expect(chart).toHaveAttribute('data-layout', 'vertical');
    });

    it('should swap axis types in horizontal mode', () => {
      render(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          horizontal
        />
      );

      const xAxis = screen.getByTestId('x-axis');
      const yAxis = screen.getByTestId('y-axis');

      expect(xAxis).toHaveAttribute('data-type', 'number');
      expect(yAxis).toHaveAttribute('data-type', 'category');
    });

    it('should use correct axis types in vertical mode', () => {
      render(
        <BarChart data={mockData} dataKeys={['revenue']} />
      );

      const xAxis = screen.getByTestId('x-axis');
      const yAxis = screen.getByTestId('y-axis');

      expect(xAxis).not.toHaveAttribute('data-type', 'number');
      expect(yAxis).not.toHaveAttribute('data-type', 'category');
    });
  });

  describe('Legend', () => {
    it('should show legend by default', () => {
      render(
        <BarChart data={mockData} dataKeys={['revenue']} />
      );

      expect(screen.getByTestId('legend')).toBeInTheDocument();
    });

    it('should hide legend when showLegend=false', () => {
      render(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          showLegend={false}
        />
      );

      expect(screen.queryByTestId('legend')).not.toBeInTheDocument();
    });

    it('should show legend when showLegend=true explicitly', () => {
      render(
        <BarChart
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
      render(
        <BarChart data={mockData} dataKeys={['revenue']} />
      );

      const container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '300');
    });

    it('should use custom height', () => {
      render(
        <BarChart data={mockData} dataKeys={['revenue']} height={400} />
      );

      const container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '400');
    });

    it('should handle small height', () => {
      render(
        <BarChart data={mockData} dataKeys={['revenue']} height={200} />
      );

      const container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '200');
    });

    it('should handle large height', () => {
      render(
        <BarChart data={mockData} dataKeys={['revenue']} height={600} />
      );

      const container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '600');
    });
  });

  describe('Value Formatting', () => {
    it('should apply formatValue to axes', () => {
      const formatValue = (value: number) => `$${value}`;

      render(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          formatValue={formatValue}
        />
      );

      const yAxis = screen.getByTestId('y-axis');
      expect(yAxis).toHaveAttribute('data-formatter', 'true');
    });

    it('should work without formatValue', () => {
      render(
        <BarChart data={mockData} dataKeys={['revenue']} />
      );

      const yAxis = screen.getByTestId('y-axis');
      expect(yAxis).toBeInTheDocument();
    });

    it('should apply formatter to X-axis in horizontal mode', () => {
      const formatValue = (value: number) => `$${value}`;

      render(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          formatValue={formatValue}
          horizontal
        />
      );

      const xAxis = screen.getByTestId('x-axis');
      expect(xAxis).toHaveAttribute('data-formatter', 'true');
    });
  });

  describe('Edge Cases', () => {
    it('should handle negative values', () => {
      const negativeData = [
        { name: 'Jan', revenue: -100, costs: 200 },
        { name: 'Feb', revenue: 150, costs: -50 },
      ];

      render(
        <BarChart data={negativeData} dataKeys={['revenue', 'costs']} />
      );

      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('should handle zero values', () => {
      const zeroData = [
        { name: 'Jan', revenue: 0, costs: 200 },
        { name: 'Feb', revenue: 150, costs: 0 },
      ];

      render(
        <BarChart data={zeroData} dataKeys={['revenue', 'costs']} />
      );

      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('should handle very large values', () => {
      const largeData = [
        { name: 'Jan', revenue: 1000000, costs: 500000 },
        { name: 'Feb', revenue: 2000000, costs: 1000000 },
      ];

      render(
        <BarChart data={largeData} dataKeys={['revenue', 'costs']} />
      );

      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('should handle decimal values', () => {
      const decimalData = [
        { name: 'Jan', revenue: 100.5, costs: 50.25 },
        { name: 'Feb', revenue: 150.75, costs: 75.5 },
      ];

      render(
        <BarChart data={decimalData} dataKeys={['revenue', 'costs']} />
      );

      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('should handle many data points', () => {
      const manyPoints = Array.from({ length: 50 }, (_, i) => ({
        name: `Point ${i + 1}`,
        value: i * 100,
      }));

      render(
        <BarChart data={manyPoints} dataKeys={['value']} />
      );

      const chart = screen.getByTestId('bar-chart');
      expect(chart).toHaveAttribute('data-points', '50');
    });

    it('should handle many data keys', () => {
      const multiKeyData = [
        {
          name: 'Jan',
          a: 100,
          b: 200,
          c: 300,
          d: 400,
          e: 500,
        },
      ];

      render(
        <BarChart
          data={multiKeyData}
          dataKeys={['a', 'b', 'c', 'd', 'e']}
        />
      );

      expect(screen.getByTestId('bar-a')).toBeInTheDocument();
      expect(screen.getByTestId('bar-e')).toBeInTheDocument();
    });

    it('should not crash with undefined className', () => {
      const { container } = render(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          className={undefined}
        />
      );

      expect(container.firstChild).toBeInTheDocument();
    });

    it('should not crash with empty title', () => {
      render(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          title=""
        />
      );

      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('should handle data with additional properties', () => {
      const complexData = [
        { name: 'Jan', revenue: 100, costs: 50, extra: 'info', label: 'January' },
      ];

      render(
        <BarChart data={complexData} dataKeys={['revenue', 'costs']} />
      );

      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });
  });

  describe('Integration Scenarios', () => {
    it('should work with all props combined', () => {
      render(
        <BarChart
          data={mockData}
          dataKeys={['revenue', 'costs']}
          title="Complete Chart"
          description="With all features"
          colors={['#ff0000', '#00ff00']}
          stacked
          horizontal
          formatValue={(v) => `$${v}`}
          height={400}
          showLegend
          className="custom-class"
        />
      );

      expect(screen.getByText('Complete Chart')).toBeInTheDocument();
      expect(screen.getByText('With all features')).toBeInTheDocument();
      expect(screen.getByTestId('bar-revenue')).toHaveAttribute(
        'data-fill',
        '#ff0000'
      );
      expect(screen.getByTestId('bar-revenue')).toHaveAttribute(
        'data-stacked',
        'true'
      );
    });

    it('should work with minimal props', () => {
      render(
        <BarChart data={mockData} dataKeys={['revenue']} />
      );

      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('should combine stacked and horizontal modes', () => {
      render(
        <BarChart
          data={mockData}
          dataKeys={['revenue', 'costs']}
          stacked
          horizontal
        />
      );

      const chart = screen.getByTestId('bar-chart');
      expect(chart).toHaveAttribute('data-layout', 'vertical');
      expect(screen.getByTestId('bar-revenue')).toHaveAttribute(
        'data-stacked',
        'true'
      );
    });
  });

  describe('Dynamic Updates', () => {
    it('should update when data changes', () => {
      const { rerender } = render(
        <BarChart data={mockData} dataKeys={['revenue']} />
      );

      const chart = screen.getByTestId('bar-chart');
      expect(chart).toHaveAttribute('data-points', '4');

      const newData = [{ name: 'May', revenue: 5000 }];

      rerender(
        <BarChart data={newData} dataKeys={['revenue']} />
      );

      expect(chart).toHaveAttribute('data-points', '1');
    });

    it('should update when dataKeys change', () => {
      const { rerender } = render(
        <BarChart data={mockData} dataKeys={['revenue']} />
      );

      expect(screen.getByTestId('bar-revenue')).toBeInTheDocument();
      expect(screen.queryByTestId('bar-costs')).not.toBeInTheDocument();

      rerender(
        <BarChart data={mockData} dataKeys={['revenue', 'costs']} />
      );

      expect(screen.getByTestId('bar-revenue')).toBeInTheDocument();
      expect(screen.getByTestId('bar-costs')).toBeInTheDocument();
    });

    it('should update when colors change', () => {
      const { rerender } = render(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          colors={['#ff0000']}
        />
      );

      let bar = screen.getByTestId('bar-revenue');
      expect(bar).toHaveAttribute('data-fill', '#ff0000');

      rerender(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          colors={['#00ff00']}
        />
      );

      bar = screen.getByTestId('bar-revenue');
      expect(bar).toHaveAttribute('data-fill', '#00ff00');
    });

    it('should update when stacked prop changes', () => {
      const { rerender } = render(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          stacked={false}
        />
      );

      let bar = screen.getByTestId('bar-revenue');
      expect(bar).toHaveAttribute('data-stacked', 'false');

      rerender(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          stacked={true}
        />
      );

      bar = screen.getByTestId('bar-revenue');
      expect(bar).toHaveAttribute('data-stacked', 'true');
    });

    it('should update when horizontal prop changes', () => {
      const { rerender } = render(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          horizontal={false}
        />
      );

      let chart = screen.getByTestId('bar-chart');
      expect(chart).toHaveAttribute('data-layout', 'horizontal');

      rerender(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          horizontal={true}
        />
      );

      chart = screen.getByTestId('bar-chart');
      expect(chart).toHaveAttribute('data-layout', 'vertical');
    });

    it('should update when showLegend changes', () => {
      const { rerender } = render(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          showLegend={true}
        />
      );

      expect(screen.getByTestId('legend')).toBeInTheDocument();

      rerender(
        <BarChart
          data={mockData}
          dataKeys={['revenue']}
          showLegend={false}
        />
      );

      expect(screen.queryByTestId('legend')).not.toBeInTheDocument();
    });
  });
});
