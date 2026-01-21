'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Minus, LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: number;
  trendLabel?: string;
  icon?: LucideIcon;
  formatValue?: (value: number | string) => string;
  className?: string;
  colorScheme?: 'default' | 'success' | 'warning' | 'error' | 'info';
  loading?: boolean;
}

/**
 * Get trend indicator component
 */
function getTrendIndicator(trend?: number) {
  if (trend === undefined || trend === null) return null;

  const isPositive = trend > 0;
  const isNeutral = trend === 0;

  if (isNeutral) {
    return {
      icon: Minus,
      color: 'text-muted-foreground',
      bgColor: 'bg-muted',
    };
  }

  return {
    icon: isPositive ? TrendingUp : TrendingDown,
    color: isPositive ? 'text-green-600' : 'text-red-600',
    bgColor: isPositive ? 'bg-green-50 dark:bg-green-950' : 'bg-red-50 dark:bg-red-950',
  };
}

/**
 * Get color scheme classes
 */
function getColorScheme(scheme: MetricCardProps['colorScheme']) {
  switch (scheme) {
    case 'success':
      return 'border-green-200 dark:border-green-800';
    case 'warning':
      return 'border-amber-200 dark:border-amber-800';
    case 'error':
      return 'border-red-200 dark:border-red-800';
    case 'info':
      return 'border-blue-200 dark:border-blue-800';
    default:
      return '';
  }
}

/**
 * MetricCard Component
 *
 * Displays a single metric with optional trend indicator and icon
 * Used in analytics dashboards to show KPIs
 *
 * @example
 * ```tsx
 * <MetricCard
 *   label="Total Revenue"
 *   value={45231}
 *   trend={12.5}
 *   trendLabel="vs last month"
 *   icon={DollarSign}
 *   formatValue={(v) => `$${v.toLocaleString()}`}
 * />
 * ```
 */
export default function MetricCard({
  label,
  value,
  trend,
  trendLabel = 'vs last period',
  icon: Icon,
  formatValue,
  className,
  colorScheme = 'default',
  loading = false,
}: MetricCardProps) {
  const trendIndicator = getTrendIndicator(trend);
  const displayValue = formatValue && typeof value !== 'string'
    ? formatValue(value)
    : typeof value === 'number'
    ? value.toLocaleString()
    : value;

  return (
    <Card className={cn('relative overflow-hidden', getColorScheme(colorScheme), className)}>
      <CardContent className="p-6">
        {loading ? (
          <div className="space-y-3">
            <div className="h-4 w-24 bg-muted animate-pulse rounded" />
            <div className="h-8 w-32 bg-muted animate-pulse rounded" />
            <div className="h-3 w-20 bg-muted animate-pulse rounded" />
          </div>
        ) : (
          <>
            {/* Header with label and icon */}
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-muted-foreground">{label}</p>
              {Icon && (
                <div className="rounded-full bg-primary/10 p-2">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
              )}
            </div>

            {/* Value */}
            <div className="mb-3">
              <p className="text-3xl font-bold tracking-tight">{displayValue}</p>
            </div>

            {/* Trend indicator */}
            {trendIndicator && trend !== undefined && (
              <div className="flex items-center gap-1.5">
                <div className={cn('rounded-full p-1', trendIndicator.bgColor)}>
                  <trendIndicator.icon className={cn('h-3 w-3', trendIndicator.color)} />
                </div>
                <span className={cn('text-sm font-medium', trendIndicator.color)}>
                  {trend > 0 && '+'}
                  {trend.toFixed(1)}%
                </span>
                <span className="text-xs text-muted-foreground">{trendLabel}</span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
