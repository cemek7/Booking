'use client';

import React from 'react';
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import GlassCard from '@/components/ui/GlassCard';

interface PieDataPoint {
  name: string;
  value: number;
  color?: string;
}

type PieChartProps = {
  data: PieDataPoint[];
  height?: number;
  title?: string;
  className?: string;
  innerRadius?: number;
};

const DEFAULT_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

function PieChart({ data, height = 280, title, className, innerRadius = 0 }: PieChartProps) {
  return (
    <GlassCard className={`p-4 ${className ?? ''}`}>
      {title && <p className="text-sm font-medium text-gray-700 mb-3">{title}</p>}
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
          No data available
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <RechartsPieChart>
            <Pie
              data={data as any}
              cx="50%"
              cy="50%"
              innerRadius={innerRadius}
              outerRadius="70%"
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip formatter={(value) => (value as number).toLocaleString()} />
            <Legend />
          </RechartsPieChart>
        </ResponsiveContainer>
      )}
    </GlassCard>
  );
}

export default PieChart;
