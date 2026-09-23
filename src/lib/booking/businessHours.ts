export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export type DayKey = (typeof DAY_KEYS)[number];

export type DayHours = {
  open: string | null;
  close: string | null;
  closed: boolean;
};

export type BusinessHours = Record<DayKey, DayHours>;

export type LegacyBusinessHoursRow = {
  day_of_week: number;
  start_time: string | null;
  end_time: string | null;
  is_open?: boolean | null;
};

const LONG_DAY_KEYS: Record<string, DayKey> = {
  monday: 'mon',
  tuesday: 'tue',
  wednesday: 'wed',
  thursday: 'thu',
  friday: 'fri',
  saturday: 'sat',
  sunday: 'sun',
};

const POSTGRES_DAY_KEYS: Record<number, DayKey> = {
  0: 'sun',
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
};

const WEEKDAY_TO_KEY: Record<string, DayKey> = {
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
  Sun: 'sun',
};

const DEFAULT_TIMEZONE = 'Africa/Lagos';
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  mon: { open: '09:00', close: '17:00', closed: false },
  tue: { open: '09:00', close: '17:00', closed: false },
  wed: { open: '09:00', close: '17:00', closed: false },
  thu: { open: '09:00', close: '17:00', closed: false },
  fri: { open: '09:00', close: '17:00', closed: false },
  sat: { open: null, close: null, closed: true },
  sun: { open: null, close: null, closed: true },
};

function cloneDefaultHours(): BusinessHours {
  return Object.fromEntries(
    DAY_KEYS.map((day) => [day, { ...DEFAULT_BUSINESS_HOURS[day] }])
  ) as BusinessHours;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.slice(0, 5);
  return TIME_PATTERN.test(compact) ? compact : null;
}

export function normalizeBusinessHours(value: unknown): BusinessHours | null {
  const record = asRecord(value);
  if (!record) return null;

  const normalized = cloneDefaultHours();
  let recognizedDays = 0;

  for (const [rawKey, rawHours] of Object.entries(record)) {
    const key = DAY_KEYS.includes(rawKey as DayKey)
      ? rawKey as DayKey
      : LONG_DAY_KEYS[rawKey.toLowerCase()];
    if (!key) continue;

    const hours = asRecord(rawHours);
    if (!hours) return null;
    recognizedDays += 1;

    if (hours.closed === true) {
      normalized[key] = { open: null, close: null, closed: true };
      continue;
    }

    const open = normalizeTime(hours.open);
    const close = normalizeTime(hours.close);
    if (!open || !close || open >= close) return null;
    normalized[key] = { open, close, closed: false };
  }

  return recognizedDays > 0 ? normalized : null;
}

function normalizeLegacyRows(rows: LegacyBusinessHoursRow[] | null | undefined): BusinessHours | null {
  if (!rows?.length) return null;
  const normalized = cloneDefaultHours();
  let recognizedDays = 0;

  for (const row of rows) {
    const key = POSTGRES_DAY_KEYS[row.day_of_week];
    if (!key) continue;
    recognizedDays += 1;
    const open = normalizeTime(row.start_time);
    const close = normalizeTime(row.end_time);
    if (row.is_open === false || !open || !close) {
      normalized[key] = { open: null, close: null, closed: true };
    } else if (open < close) {
      normalized[key] = { open, close, closed: false };
    }
  }

  return recognizedDays > 0 ? normalized : null;
}

export function resolveBusinessHours(input: {
  settings?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  legacyRows?: LegacyBusinessHoursRow[] | null;
}): BusinessHours {
  const canonical = normalizeBusinessHours(input.settings?.business_hours);
  if (canonical) return canonical;

  const legacyCamelCase = normalizeBusinessHours(input.settings?.businessHours);
  if (legacyCamelCase) return legacyCamelCase;

  const metadata = normalizeBusinessHours(input.metadata?.business_hours ?? input.metadata?.hours);
  if (metadata) return metadata;

  return normalizeLegacyRows(input.legacyRows) ?? cloneDefaultHours();
}

export function normalizeTimezone(timezone: string | null | undefined): string {
  const candidate = timezone?.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format();
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function partsAt(instantMs: number, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function offsetAt(instantMs: number, timezone: string): number {
  const local = partsAt(instantMs, timezone);
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - instantMs;
}

function matchesLocal(candidateMs: number, desired: LocalParts, timezone: string): boolean {
  const actual = partsAt(candidateMs, timezone);
  return Object.keys(desired).every(
    (key) => actual[key as keyof LocalParts] === desired[key as keyof LocalParts]
  );
}

export function localDateTimeToUtc(date: string, time: string, timezone?: string | null): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!dateMatch || !TIME_PATTERN.test(time)) {
    throw new Error('Invalid local booking date or time');
  }

  const desired: LocalParts = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(time.slice(0, 2)),
    minute: Number(time.slice(3, 5)),
    second: 0,
  };
  const naiveUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second
  );
  if (
    new Date(naiveUtc).getUTCFullYear() !== desired.year ||
    new Date(naiveUtc).getUTCMonth() + 1 !== desired.month ||
    new Date(naiveUtc).getUTCDate() !== desired.day
  ) {
    throw new Error('Invalid local booking date or time');
  }

  const resolvedTimezone = normalizeTimezone(timezone);
  const sampleOffsets = new Set<number>();
  for (const delta of [-36, -24, -12, 0, 12, 24, 36]) {
    sampleOffsets.add(offsetAt(naiveUtc + delta * 60 * 60 * 1000, resolvedTimezone));
  }

  const candidates = [...sampleOffsets]
    .map((offset) => naiveUtc - offset)
    .filter((candidate) => matchesLocal(candidate, desired, resolvedTimezone))
    .sort((a, b) => a - b);

  if (candidates.length === 0) {
    throw new Error(`Local time ${date} ${time} does not exist in ${resolvedTimezone}`);
  }

  return new Date(candidates[0]).toISOString();
}

function nextCalendarDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

export function utcDayBounds(date: string, timezone?: string | null): { startUtc: string; endUtc: string } {
  return {
    startUtc: localDateTimeToUtc(date, '00:00', timezone),
    endUtc: localDateTimeToUtc(nextCalendarDate(date), '00:00', timezone),
  };
}

export function businessDayKey(date: string, timezone?: string | null): DayKey {
  const instant = new Date(localDateTimeToUtc(date, '12:00', timezone));
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizeTimezone(timezone),
    weekday: 'short',
  }).format(instant);
  return WEEKDAY_TO_KEY[weekday];
}
