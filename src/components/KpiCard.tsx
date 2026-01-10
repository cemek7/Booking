"use client";
import React from 'react';

export interface KpiCardProps {
  title: string;
  value: string | number;
  delta?: number; // percentage
  trend?: 'up'|'down'|'flat';
  ariaLabel?: string;
}

function trendIcon(trend?: 'up'|'down'|'flat') {
  switch (trend) {
    case 'up': return '▲';
    case 'down': return '▼';
    case 'flat': return '▬';
    default: return '';
  }
}

export const KpiCard: React.FC<KpiCardProps> = ({ title, value, delta, trend, ariaLabel }) => {
  const formattedDelta = typeof delta === 'number' ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%` : null;
  return (
    <div className="p-4 rounded border bg-white" aria-label={ariaLabel || title}>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {(formattedDelta || trend) && (
        <div className="mt-1 flex items-center gap-2 text-sm">
          {trend && <span aria-label={`trend-${trend}`} className={trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-gray-500'}>{trendIcon(trend)}</span>}
          {formattedDelta && <span className="text-gray-600" aria-label="delta">{formattedDelta}</span>}
        </div>
      )}
    </div>
  );
};

export default KpiCard;
