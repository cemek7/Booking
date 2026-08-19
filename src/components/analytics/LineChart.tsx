'use client';

import React from 'react';
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import GlassCard from '@/components/ui/GlassCard';

interface DataPoint {
  [key: string]: string | number;
}

interface LineConfig {
  dataKey: string;
  color?: string;
  name?: string;
}

interface LineChartProps {
  data: DataPoint[];
  lines?: LineConfig[];
  xAxisKey?: string;
  height?: number;
  title?: string;
  className?: string;
}

const DEFAULT_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];

const LineChart: React.FC<LineChartProps> = ({
  data,
  lines,
  xAxisKey = 'name',
  height = 300,
  title,
  className,
}) => {
  // Auto-detect line keys from data if not provided
  const lineConfigs: LineConfig[] = lines ?? (
    data.length > 0
      ? Object.keys(data[0])
          .filter((k) => k !== xAxisKey && typeof data[0][k] === 'number')
          .map((k, i) => ({ dataKey: k, color: DEFAULT_COLORS[i % DEFAULT_COLORS.length] }))
      : []
  );

  return (
    <GlassCard className={`p-4 ${className ?? ''}`}>
      {title && <p className="text-sm font-medium text-gray-700 mb-3">{title}</p>}
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
          No data available
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <RechartsLineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey={xAxisKey} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            {lineConfigs.length > 1 && <Legend />}
            {lineConfigs.map((cfg) => (
              <Line
                key={cfg.dataKey}
                type="monotone"
                dataKey={cfg.dataKey}
                stroke={cfg.color ?? DEFAULT_COLORS[0]}
                name={cfg.name ?? cfg.dataKey}
                dot={false}
                strokeWidth={2}
              />
            ))}
          </RechartsLineChart>
        </ResponsiveContainer>
      )}
    </GlassCard>
  );
};

export default LineChart;
