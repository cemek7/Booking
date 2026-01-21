'use client';

import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  TooltipProps,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown } from 'lucide-react';

export interface TrendDataPoint {
  date: string;
  value: number;
  label?: string;
  [key: string]: string | number | undefined;
}

export interface TrendChartProps {
  data: TrendDataPoint[];
  dataKey: string;
  xAxisKey?: string;
  title?: string;
  description?: string;
  color?: string;
  showTrend?: boolean;
  formatValue?: (value: number) => string;
  height?: number;
  className?: string;
}

/**
 * Custom tooltip for trend chart
 */
const CustomTooltip: React.FC<TooltipProps<number, string> & { formatValue?: (value: number) => string }> = ({
  active,
  payload,
  label,
  formatValue,
}) => {
  if (!active || !payload || !payload.length) {
    return null;
  }

  const value = payload[0].value as number;

  return (
    <div className="rounded-lg border bg-background p-3 shadow-lg">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-lg font-bold" style={{ color: payload[0].color }}>
        {formatValue ? formatValue(value) : value.toLocaleString()}
      </p>
    </div>
  );
};

/**
 * Calculate trend percentage from data
 */
function calculateTrend(data: TrendDataPoint[], dataKey: string): number | null {
  if (data.length < 2) return null;

  const firstValue = data[0][dataKey] as number;
  const lastValue = data[data.length - 1][dataKey] as number;

  if (firstValue === 0) return null;

  return ((lastValue - firstValue) / firstValue) * 100;
}

/**
 * TrendChart Component
 *
 * Displays time-series data as a line chart with optional trend indicator
 * Uses recharts for visualization with responsive design
 *
 * @example
 * ```tsx
 * <TrendChart
 *   data={[
 *     { date: '2024-01-01', value: 100 },
 *     { date: '2024-01-02', value: 150 }
 *   ]}
 *   dataKey="value"
 *   title="Revenue Trend"
 *   formatValue={(v) => `$${v}`}
 * />
 * ```
 */
export default function TrendChart({
  data,
  dataKey,
  xAxisKey = 'date',
  title,
  description,
  color = '#3b82f6',
  showTrend = true,
  formatValue,
  height = 300,
  className,
}: TrendChartProps) {
  const trend = showTrend ? calculateTrend(data, dataKey) : null;
  const isTrendPositive = trend !== null && trend > 0;

  return (
    <Card className={className}>
      {(title || description) && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              {title && <CardTitle className="text-base font-semibold">{title}</CardTitle>}
              {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
            </div>
            {trend !== null && (
              <div className="flex items-center gap-1">
                {isTrendPositive ? (
                  <TrendingUp className="h-4 w-4 text-green-600" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-600" />
                )}
                <span
                  className={`text-sm font-medium ${
                    isTrendPositive ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {isTrendPositive ? '+' : ''}
                  {trend.toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        </CardHeader>
      )}
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart
            data={data}
            margin={{
              top: 5,
              right: 10,
              left: 10,
              bottom: 5,
            }}
          >
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
              tickFormatter={(value) => (formatValue ? formatValue(value) : value.toLocaleString())}
              className="text-muted-foreground"
            />
            <Tooltip content={<CustomTooltip formatValue={formatValue} />} />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              dot={{ fill: color, r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
