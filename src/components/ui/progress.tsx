'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface ProgressProps {
  value?: number;
  max?: number;
  className?: string;
}

export function Progress({ value = 0, max = 100, className }: ProgressProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  return (
    <div className={cn('relative h-2 w-full overflow-hidden rounded-full bg-secondary', className)}>
      <div
        className="h-full bg-primary transition-all"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}
