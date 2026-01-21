'use client';

import React from 'react';
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
  TooltipProps,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface PieDataPoint {
  name: string;
  value: number;
  color?: string;
}

export interface PieChartProps {
  data: PieDataPoint[];
  title?: string;
  description?: string;
  colors?: string[];
  formatValue?: (value: number) => string;
  showPercentage?: boolean;
  height?: number;
  className?: string;
  innerRadius?: number;
}

/**
 * Custom tooltip for pie chart
 */
const CustomTooltip: React.FC<
  TooltipProps<number, string> & {
    formatValue?: (value: number) => string;
    showPercentage?: boolean;
    total?: number;
  }
> = ({ active, payload, formatValue, showPercentage, total }) => {
  if (!active || !payload || !payload.length) {
    return null;
  }

  const value = payload[0].value as number;
  const percentage = total && total > 0 ? (value / total) * 100 : 0;

  return (
    <div className="rounded-lg border bg-background p-3 shadow-lg">
      <p className="text-sm font-medium mb-1">{payload[0].name}</p>
      <p className="text-lg font-bold" style={{ color: payload[0].payload.fill }}>
        {formatValue ? formatValue(value) : value.toLocaleString()}
      </p>
      {showPercentage && (
        <p className="text-sm text-muted-foreground">{percentage.toFixed(1)}%</p>
      )}
    </div>
  );
};

/**
 * Custom label for pie chart slices
 */
const renderCustomLabel = ({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
}: {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
}) => {
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  // Only show label if percentage is > 5%
  if (percent < 0.05) return null;

  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      className="text-xs font-semibold"
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

/**
 * Default color palette for pie chart
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
  '#84cc16', // lime
  '#14b8a6', // teal
];

/**
 * PieChart Component
 *
 * Displays proportional data as a pie or donut chart
 * Supports custom colors and percentage labels
 *
 * @example
 * ```tsx
 * <PieChart
 *   data={[
 *     { name: 'Desktop', value: 400 },
 *     { name: 'Mobile', value: 300 },
 *     { name: 'Tablet', value: 200 }
 *   ]}
 *   title="Traffic Sources"
 *   showPercentage
 * />
 * ```
 */
export default function PieChart({
  data,
  title,
  description,
  colors = DEFAULT_COLORS,
  formatValue,
  showPercentage = true,
  height = 300,
  className,
  innerRadius = 0,
}: PieChartProps) {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  // Apply custom colors from data or use default colors
  const dataWithColors = data.map((item, index) => ({
    ...item,
    fill: item.color || colors[index % colors.length],
  }));

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
          <RechartsPieChart>
            <Pie
              data={dataWithColors}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={showPercentage ? renderCustomLabel : false}
              outerRadius={Math.min(height * 0.35, 120)}
              innerRadius={innerRadius}
              fill="#8884d8"
              dataKey="value"
              paddingAngle={2}
            >
              {dataWithColors.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip
              content={
                <CustomTooltip
                  formatValue={formatValue}
                  showPercentage={showPercentage}
                  total={total}
                />
              }
            />
            <Legend
              verticalAlign="bottom"
              height={36}
              wrapperStyle={{ fontSize: '12px' }}
              formatter={(value, entry: any) => {
                const percentage = total > 0 ? ((entry.value / total) * 100).toFixed(1) : 0;
                return `${value} (${percentage}%)`;
              }}
            />
          </RechartsPieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
