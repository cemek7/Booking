'use client';

import React from 'react';
import { Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type TimePeriod = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

export interface DateRangePickerProps {
  period: TimePeriod;
  onPeriodChange: (period: TimePeriod) => void;
  onCustomDateClick?: () => void;
  className?: string;
  compact?: boolean;
}

const PERIOD_OPTIONS: { value: TimePeriod; label: string; description?: string }[] = [
  { value: 'day', label: 'Today', description: 'Last 24 hours' },
  { value: 'week', label: 'This Week', description: 'Last 7 days' },
  { value: 'month', label: 'This Month', description: 'Last 30 days' },
  { value: 'quarter', label: 'This Quarter', description: 'Last 90 days' },
  { value: 'year', label: 'This Year', description: 'Last 365 days' },
  { value: 'custom', label: 'Custom Range', description: 'Pick dates' },
];

/**
 * DateRangePicker Component
 *
 * Period selector for analytics with preset ranges
 * Supports day, week, month, quarter, year, and custom ranges
 *
 * @example
 * ```tsx
 * <DateRangePicker
 *   period={selectedPeriod}
 *   onPeriodChange={(period) => setSelectedPeriod(period)}
 *   onCustomDateClick={() => setShowCalendar(true)}
 * />
 * ```
 */
export default function DateRangePicker({
  period,
  onPeriodChange,
  onCustomDateClick,
  className,
  compact = false,
}: DateRangePickerProps) {
  const handlePeriodChange = (value: string) => {
    const newPeriod = value as TimePeriod;

    if (newPeriod === 'custom' && onCustomDateClick) {
      onCustomDateClick();
    } else {
      onPeriodChange(newPeriod);
    }
  };

  const selectedOption = PERIOD_OPTIONS.find((opt) => opt.value === period);

  if (compact) {
    return (
      <Select value={period} onValueChange={handlePeriodChange}>
        <SelectTrigger className={className}>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <SelectValue />
          </div>
        </SelectTrigger>
        <SelectContent>
          {PERIOD_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">Period:</span>
      </div>

      <div className="flex flex-wrap gap-2 mt-2">
        {PERIOD_OPTIONS.map((option) => (
          <Button
            key={option.value}
            variant={period === option.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => handlePeriodChange(option.value)}
            className="flex flex-col items-start h-auto py-2 px-3"
          >
            <span className="font-medium">{option.label}</span>
            {option.description && (
              <span className="text-xs opacity-70">{option.description}</span>
            )}
          </Button>
        ))}
      </div>
    </div>
  );
}
