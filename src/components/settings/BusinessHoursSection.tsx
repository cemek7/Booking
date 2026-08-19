"use client";

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABELS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

export type DayHours = {
  open: string | null;
  close: string | null;
  closed: boolean;
};

export type BusinessHours = Record<string, DayHours>;

const DEFAULT_HOURS: BusinessHours = Object.fromEntries(
  DAYS.map((d) => [
    d,
    d === 'sat' || d === 'sun'
      ? { open: null, close: null, closed: true }
      : { open: '09:00', close: '17:00', closed: false },
  ])
);

interface Props {
  value: BusinessHours | null | undefined;
  onChange: (hours: BusinessHours) => void;
}

export function BusinessHoursSection({ value, onChange }: Props) {
  const hours: BusinessHours = value ?? DEFAULT_HOURS;

  function updateDay(day: string, patch: Partial<DayHours>) {
    const updated: BusinessHours = { ...hours, [day]: { ...hours[day], ...patch } };
    onChange(updated);
  }

  function applyTemplate(template: 'weekdays' | 'everyday' | 'weekends-closed') {
    const base: BusinessHours = {};
    for (const d of DAYS) {
      if (template === 'weekdays') {
        base[d] = ['mon', 'tue', 'wed', 'thu', 'fri'].includes(d)
          ? { open: '09:00', close: '17:00', closed: false }
          : { open: null, close: null, closed: true };
      } else if (template === 'everyday') {
        base[d] = { open: '09:00', close: '17:00', closed: false };
      } else {
        base[d] = d === 'sat' || d === 'sun'
          ? { open: null, close: null, closed: true }
          : { open: '09:00', close: '17:00', closed: false };
      }
    }
    onChange(base);
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <span className="text-xs text-gray-500 self-center">Quick set:</span>
        <button type="button" onClick={() => applyTemplate('weekdays')}
          className="text-xs px-2 py-1 border rounded hover:bg-gray-50">Mon–Fri 9–5</button>
        <button type="button" onClick={() => applyTemplate('everyday')}
          className="text-xs px-2 py-1 border rounded hover:bg-gray-50">Every day 9–5</button>
        <button type="button" onClick={() => applyTemplate('weekends-closed')}
          className="text-xs px-2 py-1 border rounded hover:bg-gray-50">Weekdays only</button>
      </div>

      <div className="space-y-2">
        {DAYS.map((day) => {
          const dh = hours[day] ?? { open: '09:00', close: '17:00', closed: false };
          return (
            <div key={day} className="flex items-center gap-3 py-1">
              <span className="w-24 text-sm font-medium text-gray-700">{DAY_LABELS[day]}</span>
              <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dh.closed}
                  onChange={(e) => updateDay(day, { closed: e.target.checked, open: e.target.checked ? null : '09:00', close: e.target.checked ? null : '17:00' })}
                  className="rounded"
                />
                Closed
              </label>
              {!dh.closed && (
                <>
                  <input
                    type="time"
                    value={dh.open ?? '09:00'}
                    onChange={(e) => updateDay(day, { open: e.target.value })}
                    className="border rounded px-2 py-1 text-sm w-28"
                  />
                  <span className="text-gray-400 text-sm">–</span>
                  <input
                    type="time"
                    value={dh.close ?? '17:00'}
                    onChange={(e) => updateDay(day, { close: e.target.value })}
                    className="border rounded px-2 py-1 text-sm w-28"
                  />
                </>
              )}
              {dh.closed && <span className="text-xs text-gray-400 italic">Closed all day</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
