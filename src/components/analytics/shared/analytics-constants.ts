import type { TimePeriod } from './DateRangePicker';

export const PERIOD_TO_STAFF_PERIOD: Record<TimePeriod, 'week' | 'month' | 'quarter'> = {
  day: 'week',
  week: 'week',
  month: 'month',
  quarter: 'quarter',
  year: 'quarter',
  custom: 'month',
};

export const PERIOD_DAYS: Record<TimePeriod, number> = {
  day: 1,
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
  custom: 30,
};
