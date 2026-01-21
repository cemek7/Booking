import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from '@jest/globals';
import PieChart, {
  PieDataPoint,
} from '@/components/analytics/charts/PieChart';

// Mock recharts components
jest.mock('recharts', () => ({
  PieChart: ({ children }: any) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Pie: ({ data, innerRadius, outerRadius, label, dataKey }: any) => (
    <div
      data-testid="pie"
      data-points={data?.length}
      data-inner-radius={innerRadius}
      data-outer-radius={outerRadius}
      data-show-label={!!label}
      data-key={dataKey}
    >
      {data?.map((item: any, index: number) => (
        <div key={index} data-testid={`cell-${index}`} data-fill={item.fill} />
      ))}
    </div>
  ),
  Cell: ({ fill }: any) => <div data-testid="cell" data-fill={fill} />,
  Tooltip: ({ content }: any) => <div data-testid="tooltip">{content}</div>,
  ResponsiveContainer: ({ children, height }: any) => (
    <div data-testid="responsive-container" data-height={height}>
      {children}
    </div>
  ),
  Legend: ({ formatter }: any) => (
    <div data-testid="legend" data-has-formatter={!!formatter} />
  ),
}));

const mockData: PieDataPoint[] = [
  { name: 'Desktop', value: 400 },
  { name: 'Mobile', value: 300 },
  { name: 'Tablet', value: 200 },
  { name: 'Other', value: 100 },
];

describe('PieChart', () => {
  describe('Rendering - Basic Structure', () => {
    it('should render pie chart container', () => {
      render(<PieChart data={mockData} />);

      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });

    it('should render pie element', () => {
      render(<PieChart data={mockData} />);

      expect(screen.getByTestId('pie')).toBeInTheDocument();
    });

    it('should render responsive container', () => {
      render(<PieChart data={mockData} />);

      expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    });

    it('should render tooltip', () => {
      render(<PieChart data={mockData} />);

      expect(screen.getByTestId('tooltip')).toBeInTheDocument();
    });

    it('should render legend', () => {
      render(<PieChart data={mockData} />);

      expect(screen.getByTestId('legend')).toBeInTheDocument();
    });

    it('should render with custom className', () => {
      const { container } = render(
        <PieChart data={mockData} className="custom-pie-chart" />
      );

      expect(container.querySelector('.custom-pie-chart')).toBeInTheDocument();
    });
  });

  describe('Title and Description', () => {
    it('should render title when provided', () => {
      render(<PieChart data={mockData} title="Traffic Sources" />);

      expect(screen.getByText('Traffic Sources')).toBeInTheDocument();
    });

    it('should render description when provided', () => {
      render(
        <PieChart data={mockData} description="Distribution by device type" />
      );

      expect(screen.getByText('Distribution by device type')).toBeInTheDocument();
    });

    it('should render both title and description', () => {
      render(
        <PieChart
          data={mockData}
          title="Traffic Sources"
          description="Distribution by device type"
        />
      );

      expect(screen.getByText('Traffic Sources')).toBeInTheDocument();
      expect(screen.getByText('Distribution by device type')).toBeInTheDocument();
    });

    it('should not render header when no title or description', () => {
      const { container } = render(<PieChart data={mockData} />);

      expect(container.querySelector('.pb-3')).not.toBeInTheDocument();
    });
  });

  describe('Data Display', () => {
    it('should render all data points', () => {
      render(<PieChart data={mockData} />);

      const pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-points', '4');
    });

    it('should render cells for each data point', () => {
      render(<PieChart data={mockData} />);

      expect(screen.getByTestId('cell-0')).toBeInTheDocument();
      expect(screen.getByTestId('cell-1')).toBeInTheDocument();
      expect(screen.getByTestId('cell-2')).toBeInTheDocument();
      expect(screen.getByTestId('cell-3')).toBeInTheDocument();
    });

    it('should use value as dataKey', () => {
      render(<PieChart data={mockData} />);

      const pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-key', 'value');
    });

    it('should handle empty data array', () => {
      render(<PieChart data={[]} />);

      const pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-points', '0');
    });

    it('should handle single data point', () => {
      render(<PieChart data={[mockData[0]]} />);

      const pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-points', '1');
    });

    it('should handle many data points', () => {
      const manyPoints = Array.from({ length: 20 }, (_, i) => ({
        name: `Item ${i}`,
        value: 100,
      }));

      render(<PieChart data={manyPoints} />);

      const pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-points', '20');
    });
  });

  describe('Colors', () => {
    it('should apply default colors', () => {
      render(<PieChart data={mockData} />);

      expect(screen.getByTestId('cell-0')).toHaveAttribute('data-fill', '#3b82f6');
      expect(screen.getByTestId('cell-1')).toHaveAttribute('data-fill', '#10b981');
      expect(screen.getByTestId('cell-2')).toHaveAttribute('data-fill', '#f59e0b');
      expect(screen.getByTestId('cell-3')).toHaveAttribute('data-fill', '#ef4444');
    });

    it('should use custom colors when provided', () => {
      render(
        <PieChart
          data={mockData}
          colors={['#ff0000', '#00ff00', '#0000ff', '#ffff00']}
        />
      );

      expect(screen.getByTestId('cell-0')).toHaveAttribute('data-fill', '#ff0000');
      expect(screen.getByTestId('cell-1')).toHaveAttribute('data-fill', '#00ff00');
      expect(screen.getByTestId('cell-2')).toHaveAttribute('data-fill', '#0000ff');
      expect(screen.getByTestId('cell-3')).toHaveAttribute('data-fill', '#ffff00');
    });

    it('should use color from data if provided', () => {
      const dataWithColors: PieDataPoint[] = [
        { name: 'A', value: 100, color: '#abc123' },
        { name: 'B', value: 200 },
      ];

      render(<PieChart data={dataWithColors} />);

      expect(screen.getByTestId('cell-0')).toHaveAttribute('data-fill', '#abc123');
      // Second item gets colors[1] since first item has custom color
      expect(screen.getByTestId('cell-1')).toHaveAttribute('data-fill', '#10b981');
    });

    it('should cycle colors when more data than colors', () => {
      const manyPoints = Array.from({ length: 12 }, (_, i) => ({
        name: `Item ${i}`,
        value: 100,
      }));

      render(<PieChart data={manyPoints} colors={['#ff0000', '#00ff00']} />);

      expect(screen.getByTestId('cell-0')).toHaveAttribute('data-fill', '#ff0000');
      expect(screen.getByTestId('cell-1')).toHaveAttribute('data-fill', '#00ff00');
      expect(screen.getByTestId('cell-2')).toHaveAttribute('data-fill', '#ff0000'); // Cycles
    });
  });

  describe('Inner Radius (Donut Chart)', () => {
    it('should have inner radius of 0 by default', () => {
      render(<PieChart data={mockData} />);

      const pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-inner-radius', '0');
    });

    it('should support custom inner radius', () => {
      render(<PieChart data={mockData} innerRadius={60} />);

      const pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-inner-radius', '60');
    });

    it('should create donut chart with non-zero inner radius', () => {
      render(<PieChart data={mockData} innerRadius={50} />);

      const pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-inner-radius', '50');
    });

    it('should handle small inner radius', () => {
      render(<PieChart data={mockData} innerRadius={10} />);

      const pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-inner-radius', '10');
    });

    it('should handle large inner radius', () => {
      render(<PieChart data={mockData} innerRadius={100} />);

      const pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-inner-radius', '100');
    });
  });

  describe('Percentage Display', () => {
    it('should show percentage labels by default', () => {
      render(<PieChart data={mockData} />);

      const pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-show-label', 'true');
    });

    it('should hide percentage labels when showPercentage=false', () => {
      render(<PieChart data={mockData} showPercentage={false} />);

      const pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-show-label', 'false');
    });

    it('should show percentage labels when showPercentage=true', () => {
      render(<PieChart data={mockData} showPercentage={true} />);

      const pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-show-label', 'true');
    });
  });

  describe('Height Customization', () => {
    it('should use default height', () => {
      render(<PieChart data={mockData} />);

      const container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '300');
    });

    it('should use custom height', () => {
      render(<PieChart data={mockData} height={400} />);

      const container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '400');
    });

    it('should handle small height', () => {
      render(<PieChart data={mockData} height={200} />);

      const container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '200');
    });

    it('should handle large height', () => {
      render(<PieChart data={mockData} height={500} />);

      const container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '500');
    });
  });

  describe('Legend', () => {
    it('should render legend with formatter', () => {
      render(<PieChart data={mockData} />);

      const legend = screen.getByTestId('legend');
      expect(legend).toHaveAttribute('data-has-formatter', 'true');
    });

    it('should always show legend', () => {
      render(<PieChart data={mockData} />);

      expect(screen.getByTestId('legend')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero values', () => {
      const zeroData: PieDataPoint[] = [
        { name: 'A', value: 0 },
        { name: 'B', value: 100 },
      ];

      render(<PieChart data={zeroData} />);

      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });

    it('should handle all zero values', () => {
      const allZero: PieDataPoint[] = [
        { name: 'A', value: 0 },
        { name: 'B', value: 0 },
      ];

      render(<PieChart data={allZero} />);

      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });

    it('should handle very small values', () => {
      const smallData: PieDataPoint[] = [
        { name: 'A', value: 0.1 },
        { name: 'B', value: 0.2 },
      ];

      render(<PieChart data={smallData} />);

      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });

    it('should handle very large values', () => {
      const largeData: PieDataPoint[] = [
        { name: 'A', value: 1000000 },
        { name: 'B', value: 2000000 },
      ];

      render(<PieChart data={largeData} />);

      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });

    it('should handle decimal values', () => {
      const decimalData: PieDataPoint[] = [
        { name: 'A', value: 10.5 },
        { name: 'B', value: 20.75 },
      ];

      render(<PieChart data={decimalData} />);

      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });

    it('should handle single very large slice', () => {
      const oneHuge: PieDataPoint[] = [
        { name: 'A', value: 1000 },
        { name: 'B', value: 1 },
      ];

      render(<PieChart data={oneHuge} />);

      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });

    it('should not crash with undefined className', () => {
      const { container } = render(
        <PieChart data={mockData} className={undefined} />
      );

      expect(container.firstChild).toBeInTheDocument();
    });

    it('should not crash with empty title', () => {
      render(<PieChart data={mockData} title="" />);

      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });

    it('should handle data with extra properties', () => {
      const complexData = [
        { name: 'A', value: 100, extra: 'info', label: 'Apple' },
      ];

      render(<PieChart data={complexData} />);

      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });
  });

  describe('Value Formatting', () => {
    it('should work without formatValue', () => {
      render(<PieChart data={mockData} />);

      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });

    it('should accept custom formatValue function', () => {
      const formatValue = (value: number) => `$${value}`;

      render(<PieChart data={mockData} formatValue={formatValue} />);

      // formatValue is passed to tooltip
      expect(screen.getByTestId('tooltip')).toBeInTheDocument();
    });
  });

  describe('Integration Scenarios', () => {
    it('should work with all props combined', () => {
      render(
        <PieChart
          data={mockData}
          title="Complete Chart"
          description="With all features"
          colors={['#ff0000', '#00ff00', '#0000ff', '#ffff00']}
          formatValue={(v) => `$${v}`}
          showPercentage
          height={400}
          innerRadius={60}
          className="custom-class"
        />
      );

      expect(screen.getByText('Complete Chart')).toBeInTheDocument();
      expect(screen.getByText('With all features')).toBeInTheDocument();
      expect(screen.getByTestId('cell-0')).toHaveAttribute('data-fill', '#ff0000');
    });

    it('should work with minimal props', () => {
      render(<PieChart data={mockData} />);

      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });

    it('should create donut chart with all features', () => {
      render(
        <PieChart
          data={mockData}
          title="Donut Chart"
          innerRadius={70}
          showPercentage
        />
      );

      const pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-inner-radius', '70');
      expect(pie).toHaveAttribute('data-show-label', 'true');
    });
  });

  describe('Dynamic Updates', () => {
    it('should update when data changes', () => {
      const { rerender } = render(<PieChart data={mockData} />);

      let pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-points', '4');

      const newData = [
        { name: 'A', value: 100 },
        { name: 'B', value: 200 },
      ];

      rerender(<PieChart data={newData} />);

      pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-points', '2');
    });

    it('should update when colors change', () => {
      const { rerender } = render(
        <PieChart data={mockData} colors={['#ff0000', '#00ff00']} />
      );

      let cell = screen.getByTestId('cell-0');
      expect(cell).toHaveAttribute('data-fill', '#ff0000');

      rerender(
        <PieChart data={mockData} colors={['#0000ff', '#00ff00']} />
      );

      cell = screen.getByTestId('cell-0');
      expect(cell).toHaveAttribute('data-fill', '#0000ff');
    });

    it('should update when innerRadius changes', () => {
      const { rerender } = render(
        <PieChart data={mockData} innerRadius={0} />
      );

      let pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-inner-radius', '0');

      rerender(<PieChart data={mockData} innerRadius={60} />);

      pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-inner-radius', '60');
    });

    it('should update when showPercentage changes', () => {
      const { rerender } = render(
        <PieChart data={mockData} showPercentage={true} />
      );

      let pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-show-label', 'true');

      rerender(<PieChart data={mockData} showPercentage={false} />);

      pie = screen.getByTestId('pie');
      expect(pie).toHaveAttribute('data-show-label', 'false');
    });

    it('should update when height changes', () => {
      const { rerender } = render(<PieChart data={mockData} height={300} />);

      let container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '300');

      rerender(<PieChart data={mockData} height={500} />);

      container = screen.getByTestId('responsive-container');
      expect(container).toHaveAttribute('data-height', '500');
    });
  });
});
