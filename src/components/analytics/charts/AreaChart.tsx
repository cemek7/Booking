'use client';

import React from 'react';
import {
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  TooltipProps,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface AreaDataPoint {
  date: string;
  [key: string]: string | number;
}

export interface AreaChartProps {
  data: AreaDataPoint[];
  dataKeys: string[];
  xAxisKey?: string;
  title?: string;
  description?: string;
  colors?: string[];
  stacked?: boolean;
  formatValue?: (value: number) => string;
  height?: number;
  className?: string;
  showLegend?: boolean;
}

/**
 * Custom tooltip for area chart
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
 * Default color palette for area chart
 */
const DEFAULT_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
];

/**
 * AreaChart Component
 *
 * Displays time-series data as filled area charts
 * Supports multiple data series, stacking, and gradient fills
 *
 * @example
 * ```tsx
 * <AreaChart
 *   data={[
 *     { date: '2024-01', revenue: 4000, expenses: 2400 },
 *     { date: '2024-02', revenue: 3000, expenses: 1398 }
 *   ]}
 *   dataKeys={['revenue', 'expenses']}
 *   title="Revenue vs Expenses"
 *   stacked
 * />
 * ```
 */
export default function AreaChart({
  data,
  dataKeys,
  xAxisKey = 'date',
  title,
  description,
  colors = DEFAULT_COLORS,
  stacked = false,
  formatValue,
  height = 300,
  className,
  showLegend = true,
}: AreaChartProps) {
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
          <RechartsAreaChart
            data={data}
            margin={{
              top: 5,
              right: 10,
              left: 10,
              bottom: 5,
            }}
          >
            {/* Define gradients for each data series */}
            <defs>
              {dataKeys.map((key, index) => {
                const color = colors[index % colors.length];
                return (
                  <linearGradient key={key} id={`gradient-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.8} />
                    <stop offset="95%" stopColor={color} stopOpacity={0.1} />
                  </linearGradient>
                );
              })}
            </defs>

            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey={xAxisKey}
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
            <Tooltip content={<CustomTooltip formatValue={formatValue} />} />
            {showLegend && <Legend wrapperStyle={{ fontSize: '12px' }} />}

            {dataKeys.map((key, index) => {
              const color = colors[index % colors.length];
              return (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#gradient-${key})`}
                  stackId={stacked ? 'stack' : undefined}
                />
              );
            })}
          </RechartsAreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
