'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface StatsGridProps {
  children: React.ReactNode;
  columns?: 1 | 2 | 3 | 4;
  gap?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * StatsGrid Component
 *
 * Responsive grid layout for displaying MetricCard components
 * Automatically adjusts columns based on screen size
 *
 * @example
 * ```tsx
 * <StatsGrid columns={4}>
 *   <MetricCard label="Total Revenue" value={45231} trend={12.5} />
 *   <MetricCard label="Total Bookings" value={423} trend={8.2} />
 *   <MetricCard label="Active Staff" value={24} trend={-2.1} />
 *   <MetricCard label="Avg Rating" value="4.8" />
 * </StatsGrid>
 * ```
 */
export default function StatsGrid({
  children,
  columns = 4,
  gap = 'md',
  className,
}: StatsGridProps) {
  // Map column count to responsive grid classes
  const gridColsClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
  }[columns];

  // Map gap size to Tailwind gap classes
  const gapClass = {
    sm: 'gap-3',
    md: 'gap-4',
    lg: 'gap-6',
  }[gap];

  return (
    <div className={cn('grid', gridColsClass, gapClass, className)}>
      {children}
    </div>
  );
}
