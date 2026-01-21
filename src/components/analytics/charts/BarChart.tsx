'use client';

import React from 'react';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  TooltipProps,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface BarDataPoint {
  name: string;
  [key: string]: string | number;
}

export interface BarChartProps {
  data: BarDataPoint[];
  dataKeys: string[];
  title?: string;
  description?: string;
  colors?: string[];
  stacked?: boolean;
  horizontal?: boolean;
  formatValue?: (value: number) => string;
  height?: number;
  className?: string;
  showLegend?: boolean;
}

/**
 * Custom tooltip for bar chart
 */
const CustomTooltip: React.FC<
  TooltipProps<number, string> & { formatValue?: (value: number) => string }
> = ({ active, payload, label, formatValue }) => {
  if (!active || !payload || !payload.length) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-background p-3 shadow-lg">
      <p className="text-sm font-medium mb-2">{label}</p>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 text-sm">
          <div
            className="w-3 h-3 rounded"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-semibold">
            {formatValue && typeof entry.value === 'number'
              ? formatValue(entry.value)
              : (entry.value as number)?.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
};

/**
 * Default color palette for bars
 */
const DEFAULT_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

/**
 * BarChart Component
 *
 * Displays categorical data as vertical or horizontal bars
 * Supports multiple data series and stacked bars
 *
 * @example
 * ```tsx
 * <BarChart
 *   data={[
 *     { name: 'Jan', revenue: 4000, costs: 2400 },
 *     { name: 'Feb', revenue: 3000, costs: 1398 }
 *   ]}
 *   dataKeys={['revenue', 'costs']}
 *   title="Monthly Comparison"
 *   stacked
 * />
 * ```
 */
export default function BarChart({
  data,
  dataKeys,
  title,
  description,
  colors = DEFAULT_COLORS,
  stacked = false,
  horizontal = false,
  formatValue,
  height = 300,
  className,
  showLegend = true,
}: BarChartProps) {
  return (
    <Card className={className}>
      {(title || description) && (
        <CardHeader className="pb-3">
          {title && <CardTitle className="text-base font-semibold">{title}</CardTitle>}
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </CardHeader>
      )}
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <RechartsBarChart
            data={data}
            layout={horizontal ? 'vertical' : 'horizontal'}
            margin={{
              top: 5,
              right: 10,
              left: horizontal ? 60 : 10,
              bottom: 5,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            {horizontal ? (
              <>
                <XAxis
                  type="number"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) =>
                    formatValue ? formatValue(value) : value.toLocaleString()
                  }
                  className="text-muted-foreground"
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  className="text-muted-foreground"
                />
              </>
            ) : (
              <>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  className="text-muted-foreground"
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) =>
                    formatValue ? formatValue(value) : value.toLocaleString()
                  }
                  className="text-muted-foreground"
                />
              </>
            )}
            <Tooltip content={<CustomTooltip formatValue={formatValue} />} />
            {showLegend && <Legend wrapperStyle={{ fontSize: '12px' }} />}
            {dataKeys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                fill={colors[index % colors.length]}
                stackId={stacked ? 'stack' : undefined}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </RechartsBarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
