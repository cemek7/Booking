'use client';

import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import GlassCard from '@/components/ui/GlassCard';

interface UsagePoint {
  date?: string;
  month?: string;
  week?: string;
  label?: string;
  bookings?: number;
  revenue?: number;
  [key: string]: string | number | undefined;
}

type UsageChartProps = {
  usage: UsagePoint[];
};

const UsageChart = ({ usage }: UsageChartProps) => {
  const xKey = usage.length > 0
    ? (['date', 'month', 'week', 'label'] as const).find((k) => k in usage[0]) ?? 'date'
    : 'date';

  const numericKeys = usage.length > 0
    ? Object.keys(usage[0]).filter((k) => k !== xKey && typeof usage[0][k] === 'number')
    : [];

  const COLORS: Record<string, string> = {
    bookings: '#6366f1',
    revenue: '#22c55e',
    users: '#f59e0b',
    sessions: '#8b5cf6',
  };

  return (
    <GlassCard className="p-6">
      {usage.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
          No usage data available
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={192}>
          <AreaChart data={usage} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <defs>
              {numericKeys.map((key, i) => (
                <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor={COLORS[key] ?? ['#6366f1', '#22c55e', '#f59e0b'][i % 3]}
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor={COLORS[key] ?? ['#6366f1', '#22c55e', '#f59e0b'][i % 3]}
                    stopOpacity={0}
                  />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            {numericKeys.map((key, i) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={COLORS[key] ?? ['#6366f1', '#22c55e', '#f59e0b'][i % 3]}
                fill={`url(#grad-${key})`}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </GlassCard>
  );
};

export default UsageChart;
