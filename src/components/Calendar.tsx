"use client";
import React, { useMemo } from 'react';

export type ViewMode = 'month' | 'week' | 'day';
export interface BookingEvent {
  id: string;
  start: string; // ISO
  end: string;   // ISO
  status: 'requested'|'confirmed'|'completed'|'cancelled'|'no_show';
  serviceId: string;
  staffId?: string;
  customer: { id: string; name?: string; phone?: string; email?: string };
  metadata?: Record<string, any>;
}
export interface CalendarProps {
  view: ViewMode;
  events: BookingEvent[];
  staffLanes?: boolean;
  timezone?: string;
  onEventClick?: (event: BookingEvent) => void;
  onEventDrop?: (eventId: string, newStart: string, newEnd: string, newStaffId?: string) => Promise<void>;
  onRangeChange?: (start: string, end: string) => void;
  staffOptions?: { id: string; name?: string }[]; // for reschedule dialog staff select
}

// Simple color map for statuses
const statusColor: Record<string,string> = {
  requested: 'bg-yellow-100 border-yellow-300',
  confirmed: 'bg-green-100 border-green-300',
  completed: 'bg-blue-100 border-blue-300',
  cancelled: 'bg-gray-200 border-gray-300 line-through',
  no_show: 'bg-red-100 border-red-300'
};

function startOfTodayISO() { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString(); }

export const Calendar: React.FC<CalendarProps> = ({ view, events, staffLanes, onEventClick, onEventDrop, onRangeChange, staffOptions }) => {
  const [conflict, setConflict] = React.useState<{ message: string } | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = React.useState<{ id: string; lane?: string } | null>(null);
  const [rescheduleValues, setRescheduleValues] = React.useState<{ start: string; end: string; staffId?: string }>({ start: '', end: '' });
  // Month navigation state must be top-level to satisfy Hooks rules
  const [monthOffset, setMonthOffset] = React.useState(0);
  const staffNameMap = React.useMemo(() => {
    const map: Record<string,string> = {};
    (staffOptions || []).forEach(s => { map[s.id] = s.name || s.id; });
    map['unassigned'] = 'Unassigned';
    return map;
  }, [staffOptions]);
  // Pre-compute month grid boundaries based on monthOffset
  const firstOfMonth = React.useMemo(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth() + monthOffset, 1);
  }, [monthOffset]);
  const startOfGrid = React.useMemo(() => {
    const d = new Date(firstOfMonth);
    const dow = d.getDay();
    d.setDate(d.getDate() - dow);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [firstOfMonth]);
  const monthDays: { date: Date; key: string }[] = React.useMemo(() => {
    const arr: { date: Date; key: string }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(startOfGrid.getTime() + i * 86400000);
      arr.push({ date: d, key: d.toISOString().slice(0, 10) });
    }
    return arr;
  }, [startOfGrid]);

  // Unified visible range per view
  const range = useMemo(() => {
    // Use stable midnight-based ranges to avoid re-firing onRangeChange each render
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // midnight today
    if (view === 'day') {
      const start = today.toISOString();
      const end = new Date(today.getTime() + 86400000).toISOString();
      return { start, end };
    }
    if (view === 'week') {
      const dow = today.getDay();
      const startDate = new Date(today.getTime() - dow * 86400000);
      const endDate = new Date(startDate.getTime() + 7 * 86400000);
      return { start: startDate.toISOString(), end: endDate.toISOString() };
    }
    // month uses monthDays grid
    const start = monthDays[0]?.date.toISOString();
    const end = monthDays[monthDays.length - 1]?.date.toISOString();
    return { start: start || new Date(today.getFullYear(), today.getMonth(), 1).toISOString(), end: end || new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString() };
  }, [view, monthDays]);

  // Notify range change (dedup to avoid loops)
  const lastRangeRef = React.useRef<{ start: string; end: string } | null>(null);
  React.useEffect(() => {
    if (!onRangeChange) return;
    const prev = lastRangeRef.current;
    if (prev?.start === range.start && prev?.end === range.end) return;
    lastRangeRef.current = range;
    onRangeChange(range.start, range.end);
  }, [range.start, range.end, onRangeChange]);
  // Group events by staff when lanes active (declare before any early return)
  const grouped = useMemo(() => {
    if (!staffLanes) return { all: events } as any;
    const map: Record<string, BookingEvent[]> = {};
    events.forEach(ev => { const key = ev.staffId || 'unassigned'; map[key] = map[key] || []; map[key].push(ev); });
    return map;
  }, [events, staffLanes]);

  // Group events by day key (computed regardless of view to keep hooks order stable)
  const byDay = React.useMemo(() => {
    const map: Record<string, BookingEvent[]> = {};
    events.forEach(ev => {
      const k = new Date(ev.start).toISOString().slice(0, 10);
      (map[k] ||= []).push(ev);
    });
    return map;
  }, [events]);

  // Persist month in URL as ?m=YYYY-MM (only on month view)
  React.useEffect(() => {
    if (view !== 'month') return;
    if (typeof window === 'undefined') return;
    const d = firstOfMonth;
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const y = d.getFullYear();
    const url = new URL(window.location.href);
    url.searchParams.set('m', `${y}-${m}`);
    window.history.pushState({}, '', url.toString());
  }, [firstOfMonth, view]);

  // Initialize offset from URL if present (once)
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const m = url.searchParams.get('m');
    if (m) {
      const [yy, mm] = m.split('-').map(Number);
      if (!Number.isNaN(yy) && !Number.isNaN(mm)) {
        const now = new Date();
        const target = new Date(yy, (mm - 1), 1);
        const diff = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
        setMonthOffset(diff);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Month grid view (simple 7x6 calendar) when not using staff lanes
  if (!staffLanes && view === 'month') {

    const monthLabel = new Date(firstOfMonth).toLocaleString(undefined, { month: 'long', year: 'numeric' });
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);
    const currentYear = firstOfMonth.getFullYear();
    const currentMonth = firstOfMonth.getMonth();
    const isSameMonth = (d: Date) => d.getMonth() === firstOfMonth.getMonth();

    // Keyboard navigation: Left/Right arrows to change month, Home/Today to reset
    function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
      if (e.key === 'ArrowLeft') { setMonthOffset(o => o - 1); }
      else if (e.key === 'ArrowRight') { setMonthOffset(o => o + 1); }
      else if (e.key.toLowerCase() === 't' || e.key === 'Home') { setMonthOffset(0); }
    }


    return (
      <div className="border rounded bg-white p-2" aria-label="calendar-month" tabIndex={0} onKeyDown={onKeyDown}>
        {conflict && (
          <div className="mb-2 p-2 rounded border bg-red-50 border-red-200 text-xs text-red-700 flex items-center justify-between">
            <span>{conflict.message}</span>
            <button className="ml-3 px-2 py-0.5 border rounded" onClick={() => setConflict(null)}>Close</button>
          </div>
        )}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 text-xs border rounded" onClick={() => setMonthOffset(o => o - 1)} aria-label="prev-month">◀</button>
            <div className="text-sm font-semibold min-w-[8ch] text-center">{monthLabel}</div>
            <button className="px-2 py-1 text-xs border rounded" onClick={() => setMonthOffset(o => o + 1)} aria-label="next-month">▶</button>
            <button className="ml-2 px-2 py-1 text-xs border rounded" onClick={() => setMonthOffset(0)} aria-label="today">Today</button>
            {/* Mini month-picker */}
            <select
              aria-label="select-month"
              className="ml-2 px-1 py-0.5 text-xs border rounded bg-white"
              value={currentMonth}
              onChange={(e) => {
                const m = Number(e.target.value);
                const base = new Date();
                const target = new Date(currentYear, m, 1);
                const diff = (target.getFullYear() - base.getFullYear()) * 12 + (target.getMonth() - base.getMonth());
                setMonthOffset(diff);
              }}
            >
              {Array.from({ length: 12 }).map((_, i) => (
                <option key={i} value={i}>{new Date(2000, i, 1).toLocaleString(undefined, { month: 'short' })}</option>
              ))}
            </select>
            <input
              aria-label="input-year"
              className="w-16 px-1 py-0.5 text-xs border rounded ml-1"
              type="number"
              value={currentYear}
              onChange={(e) => {
                const y = Number(e.target.value) || currentYear;
                const base = new Date();
                const target = new Date(y, currentMonth, 1);
                const diff = (target.getFullYear() - base.getFullYear()) * 12 + (target.getMonth() - base.getMonth());
                setMonthOffset(diff);
              }}
            />
          </div>
          <div className="text-[10px] text-gray-500">Sun • Mon • Tue • Wed • Thu • Fri • Sat</div>
        </div>
        <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(7,minmax(0,1fr))' }}>
          {monthDays.map(({ date, key }, idx) => {
            const evs = byDay[key] || [];
            const faded = !isSameMonth(date);
            const isToday = key === todayKey;
            return (
              <div key={key + idx} className={`min-h-[110px] border rounded p-1 ${faded ? 'bg-gray-50' : 'bg-white'} ${isToday ? 'ring-1 ring-indigo-300' : ''}`}>
                <div className={`text-[10px] font-medium mb-1 flex items-center justify-between ${faded ? 'text-gray-400' : 'text-gray-700'}`}>
                  <span>{date.getDate()}</span>
                  {isToday && <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-indigo-50 text-indigo-600">Today</span>}
                </div>
                <div className="space-y-1">
                  {evs.length === 0 && <div className="text-[10px] text-gray-300" aria-label="empty-day">•</div>}
                  {evs.slice(0, 3).map(ev => (
                    <div
                      key={ev.id}
                      draggable
                      onDragStart={e => handleDragStart(e, ev)}
                      onClick={() => onEventClick?.(ev)}
                      className={`text-[10px] px-1 py-0.5 border rounded cursor-pointer ${statusColor[ev.status] || 'bg-white border-gray-200'}`}
                      aria-label="calendar-event"
                    >
                      <div className="truncate">
                        {new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {ev.customer.name || ev.customer.id}
                        {ev.staffId ? <span className="ml-1 text-[9px] text-gray-500">· {staffNameMap[ev.staffId] || ev.staffId}</span> : null}
                      </div>
                    </div>
                  ))}
                  {evs.length > 3 && (
                    <div className="text-[10px] text-gray-500">+{evs.length - 3} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  

  // Drag start/finish stubs
  function handleDragStart(e: React.DragEvent, ev: BookingEvent) { e.dataTransfer.setData('text/plain', ev.id); }
  async function handleDrop(e: React.DragEvent, lane: string) {
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    e.preventDefault();
    const targetEvent = events.find(ev => ev.id === id);
    if (!targetEvent || !onEventDrop) return;
    // open reschedule dialog – user chooses new start/end
    setRescheduleTarget({ id, lane: lane });
    const defaultStart = new Date(targetEvent.start);
    const defaultEnd = new Date(targetEvent.end);
    // propose +30m shift as initial suggestion
    const startIso = new Date(defaultStart.getTime() + 30*60000).toISOString().slice(0,16);
    const endIso = new Date(defaultEnd.getTime() + 30*60000).toISOString().slice(0,16);
    setRescheduleValues({ start: startIso, end: endIso, staffId: staffLanes ? lane : targetEvent.staffId });
  }
  function allowDrop(e: React.DragEvent) { e.preventDefault(); }

  // Week/day specialized lightweight layouts when not using staff lanes
  if (!staffLanes && view === 'week') {
    const days: Record<string, BookingEvent[]> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(new Date(range.start).getTime() + i*86400000);
      const key = d.toISOString().slice(0,10);
      days[key] = [];
    }
    events.forEach(ev => {
      const key = new Date(ev.start).toISOString().slice(0,10);
      if (days[key]) days[key].push(ev);
    });
    return (
      <div className="border rounded bg-white p-2" aria-label="calendar-basic" data-view="week" data-testid="calendar-basic">
        {conflict && (
          <div className="mb-2 p-2 rounded border bg-red-50 border-red-200 text-xs text-red-700 flex items-center justify-between">
            <span>{conflict.message}</span>
            <button className="ml-3 px-2 py-0.5 border rounded" onClick={() => setConflict(null)}>Close</button>
          </div>
        )}
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(7,minmax(0,1fr))' }}>
          {Object.entries(days).map(([dayIso, evs]) => (
            <div key={dayIso} className="min-h-[140px] border rounded flex flex-col">
              <div className="px-2 py-1 text-xs font-semibold border-b bg-gray-50">{new Date(dayIso).toLocaleDateString(undefined,{ weekday:'short', month:'numeric', day:'numeric'})}</div>
              <div className="flex-1 p-1 space-y-1 overflow-auto">
                {evs.length === 0 && <div className="text-[10px] text-gray-400" aria-label="empty-day">No events</div>}
                {evs.map(ev => (
                  <div
                    key={ev.id}
                    draggable
                    onDragStart={e => handleDragStart(e, ev)}
                    onClick={() => onEventClick?.(ev)}
                    className={`text-[10px] p-1 border rounded cursor-pointer ${statusColor[ev.status] || 'bg-white border-gray-200'}`}
                    aria-label="calendar-event"
                  >
                    <div className="font-medium truncate">{ev.customer.name || ev.customer.id}{ev.staffId ? <span className="ml-1 text-[10px] text-gray-500">· {staffNameMap[ev.staffId] || ev.staffId}</span> : null}</div>
                    <div>{new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!staffLanes && view === 'day') {
    // Build hour buckets
    const startDay = new Date(range.start); startDay.setHours(0,0,0,0);
    const hours: { hour: number; events: BookingEvent[] }[] = [];
    for (let h=0; h<24; h++) hours.push({ hour: h, events: [] });
    events.forEach(ev => {
      const d = new Date(ev.start);
      if (d.toDateString() === startDay.toDateString()) {
        hours[d.getHours()].events.push(ev);
      }
    });
    return (
      <div className="border rounded bg-white p-2" aria-label="calendar-basic" data-view="day" data-testid="calendar-basic">
        {conflict && (
          <div className="mb-2 p-2 rounded border bg-red-50 border-red-200 text-xs text-red-700 flex items-center justify-between">
            <span>{conflict.message}</span>
            <button className="ml-3 px-2 py-0.5 border rounded" onClick={() => setConflict(null)}>Close</button>
          </div>
        )}
        <div className="space-y-1">
          {hours.map(h => (
            <div key={h.hour} className="flex items-start gap-2">
              <div className="w-14 text-right pr-2 text-[10px] text-gray-500">{String(h.hour).padStart(2,'0')}:00</div>
              <div className="flex-1 min-h-6">
                {h.events.length === 0 && <div className="text-[10px] text-gray-300" aria-label="empty-hour">•</div>}
                {h.events.map(ev => (
                  <div
                    key={ev.id}
                    draggable
                    onDragStart={e => handleDragStart(e, ev)}
                    onClick={() => onEventClick?.(ev)}
                    className={`inline-block mr-1 mb-1 text-[10px] px-1 py-0.5 border rounded cursor-pointer ${statusColor[ev.status] || 'bg-white border-gray-200'}`}
                    aria-label="calendar-event"
                  >
                    {ev.customer.name || ev.customer.id}{ev.staffId ? <span className="ml-1 text-[10px] text-gray-500">· {staffNameMap[ev.staffId] || ev.staffId}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // (Removed duplicate month view block to preserve consistent hook order)

  // Render staff lanes or week/day views
  if (staffLanes) {
    return (
      <div className="relative">
        {conflict && (
          <div className="absolute inset-x-0 top-2 mx-auto max-w-md z-10">
            <div className="p-3 rounded border bg-red-50 border-red-200 text-xs text-red-700 flex items-center justify-between">
              <span>{conflict.message}</span>
              <button className="ml-3 px-2 py-0.5 border rounded" onClick={() => setConflict(null)}>Close</button>
            </div>
          </div>
        )}
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Object.keys(grouped).length}, minmax(0,1fr))` }} aria-label="calendar-staff-lanes">
        {Object.entries(grouped).map(([staffId, evs]) => (
          <div key={staffId} className="border rounded bg-white flex flex-col" onDragOver={allowDrop} onDrop={e => handleDrop(e, staffId)}>
            <div className="p-2 text-xs font-semibold border-b bg-gray-50" aria-label="lane-header">{staffNameMap[staffId] || staffId}</div>
            <div className="p-2 space-y-2">
              {evs.map(ev => (
                <div
                  key={ev.id}
                  draggable
                  onDragStart={e => handleDragStart(e, ev)}
                  onClick={() => onEventClick?.(ev)}
                  className={`text-xs p-2 border rounded shadow-sm cursor-pointer ${statusColor[ev.status] || 'bg-white border-gray-200'}`}
                  aria-label="calendar-event"
                >
                  <div className="font-medium truncate">{ev.customer.name || ev.customer.id}{ev.staffId ? <span className="ml-1 text-[10px] text-gray-500">· {staffNameMap[ev.staffId] || ev.staffId}</span> : null}</div>
                  <div>{new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–{new Date(ev.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              ))}
              {evs.length === 0 && <div className="text-xs text-gray-400" aria-label="empty-lane">No events</div>}
            </div>
          </div>
        ))}
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded bg-white p-2 relative" aria-label="calendar-basic">
      {conflict && (
        <div className="absolute inset-x-0 top-2 mx-auto max-w-md z-10">
          <div className="p-3 rounded border bg-red-50 border-red-200 text-xs text-red-700 flex items-center justify-between">
            <span>{conflict.message}</span>
            <button className="ml-3 px-2 py-0.5 border rounded" onClick={() => setConflict(null)}>Close</button>
          </div>
        </div>
      )}
      {rescheduleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="dialog" aria-label="reschedule-dialog">
          <div className="bg-white border rounded shadow-lg p-4 w-full max-w-sm space-y-3">
            <h4 className="font-semibold text-sm">Reschedule Event</h4>
            <label className="block text-xs font-medium">New Start
              <input type="datetime-local" value={rescheduleValues.start} onChange={e=>setRescheduleValues(v=>({...v,start:e.target.value}))} className="mt-1 w-full border rounded px-2 py-1" />
            </label>
            <label className="block text-xs font-medium">New End
              <input type="datetime-local" value={rescheduleValues.end} onChange={e=>setRescheduleValues(v=>({...v,end:e.target.value}))} className="mt-1 w-full border rounded px-2 py-1" />
            </label>
            {staffLanes && (
              <label className="block text-xs font-medium">Staff Lane
                <select value={rescheduleValues.staffId || ''} onChange={e=>setRescheduleValues(v=>({...v,staffId:e.target.value||undefined}))} className="mt-1 w-full border rounded px-2 py-1">
                  <option value="">Unassigned</option>
                  {(staffOptions||[]).map(s => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
                </select>
              </label>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={()=>{setRescheduleTarget(null);}} className="px-3 py-1 text-xs border rounded">Cancel</button>
              <button
                onClick={async ()=>{
                  if (!onEventDrop) return;
                  try {
                    const startIso = new Date(rescheduleValues.start).toISOString();
                    const endIso = new Date(rescheduleValues.end).toISOString();
                    await onEventDrop(rescheduleTarget.id, startIso, endIso, rescheduleValues.staffId);
                    setRescheduleTarget(null);
                  } catch (err:any) {
                    const msg = String(err?.message || err || 'Conflict while rescheduling');
                    if (msg.toLowerCase().includes('409') || msg.toLowerCase().includes('conflict')) {
                      setConflict({ message: 'Schedule conflict. Please choose a different time or staff.' });
                    } else {
                      setConflict({ message: 'Failed to reschedule. Please try again.' });
                    }
                    setRescheduleTarget(null);
                  }
                }}
                className="px-3 py-1 text-xs bg-indigo-600 text-white rounded"
              >Apply</button>
            </div>
          </div>
        </div>
      )}
      <div className="mb-2 text-xs text-gray-600">Range: {new Date(range.start).toLocaleDateString()} – {new Date(range.end).toLocaleDateString()} (view: {view})</div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))' }}>
        {events.map(ev => (
          <div
            key={ev.id}
            draggable
            onDragStart={e => handleDragStart(e, ev)}
            onClick={() => onEventClick?.(ev)}
            className={`text-xs p-2 border rounded shadow-sm cursor-pointer ${statusColor[ev.status] || 'bg-white border-gray-200'}`}
            aria-label="calendar-event"
          >
            <div className="font-medium truncate">{ev.customer.name || ev.customer.id}{ev.staffId ? <span className="ml-1 text-[10px] text-gray-500">· {staffNameMap[ev.staffId] || ev.staffId}</span> : null}</div>
            <div>{new Date(ev.start).toLocaleDateString()} {new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        ))}
        {events.length === 0 && <div className="text-xs text-gray-400" aria-label="empty-calendar">No events in range</div>}
      </div>
    </div>
  );
};

export default Calendar;
