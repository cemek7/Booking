"use client";
import { useMemo, useState } from 'react';
import { Calendar } from '@/components/Calendar';
import ConflictResolutionOverlay from '@/components/ConflictResolutionOverlay';
import ReservationsList from '@/components/reservations/ReservationsList';
import { BookingSidePanel } from '@/components/booking/BookingSidePanel';
import { BookingComposer } from '@/components/booking/BookingComposer';
import Modal from '@/components/ui/modal';
import { useQueryClient } from '@tanstack/react-query';
import { useStaff } from '@/hooks/useStaff';
import type { BookingEvent } from '@/components/Calendar';

// Type definitions for conflict resolution
interface ConflictEvent {
  id: string;
  start: string;
  end: string;
  status: string;
  staffId?: string;
}
import { useBookings } from '@/hooks/useBookings';
import { useLocation } from '@/lib/location-context';
import { useServices } from '@/hooks/useServices';
import Sidebar from '@/components/ui/sidebar';
import { useTenant } from '@/lib/supabase/tenant-context';

// range is fed by Calendar's onRangeChange; bookings fetched via useBookings

export default function SchedulePage() {
  // mode toggles between calendar and list surfaces
  const [mode, setMode] = useState<'calendar'|'list'>('calendar');
  const [view, setView] = useState<'month'|'week'|'day'>('month');
  const [staffLanes, setStaffLanes] = useState(false);
  const [openComposer, setOpenComposer] = useState(false);
  const [activeBooking, setActiveBooking] = useState<BookingEvent | null>(null);
  const qc = useQueryClient();
  const { location } = useLocation();
  const { tenant } = useTenant();
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const { data: events = [], isLoading } = useBookings({ start: range?.start || '', end: range?.end || '' });
  const { data: staff = [] } = useStaff(tenant?.id);
  const { data: services = [], isLoading: servicesLoading } = useServices(tenant?.id);
  const [conflictContext, setConflictContext] = useState<{ id: string; start: string; end: string; staffId?: string } | null>(null);
  const [conflicts, setConflicts] = useState<ConflictEvent[]>([]);
  const [conflictSource, setConflictSource] = useState<'server'|'local'>('local');

  async function handleReschedule(id: string, start: string, end: string, staffId?: string) {
    try {
      const body = { start_at: start, end_at: end, staff_id: staffId || null };
      const resp = await fetch(`/api/bookings/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (resp.status === 409) {
        // Prefer server-provided conflicts if present; fallback to local overlap
        let serverConflicts: ConflictEvent[] | null = null;
        try {
          const payload = await resp.json().catch(() => null);
          const arr = payload?.conflicts || payload?.data?.conflicts || payload?.overlaps || null;
          if (Array.isArray(arr)) {
            serverConflicts = arr.map((c: unknown) => {
              const conflict = c as Record<string, unknown>;
              return {
                id: String(conflict.id || conflict.booking_id || `${conflict.start}-${conflict.end}`),
                start: String(conflict.start || conflict.start_at || conflict.startTime),
                end: String(conflict.end || conflict.end_at || conflict.endTime),
                status: String(conflict.status || 'booked'),
                staffId: conflict.staff_id ? String(conflict.staff_id) : conflict.staffId ? String(conflict.staffId) : undefined
              };
            }).filter((c: ConflictEvent) => c.start && c.end);
          }
        } catch {}

        if (!serverConflicts) {
          const overlapping = events.filter(ev => {
            const evStart = new Date(ev.start).getTime();
            const evEnd = new Date(ev.end).getTime();
            const tStart = new Date(start).getTime();
            const tEnd = new Date(end).getTime();
            return !(tEnd <= evStart || tStart >= evEnd) && ev.id !== id;
          });
          setConflicts(overlapping);
          setConflictSource('local');
        } else {
          setConflicts(serverConflicts);
          setConflictSource('server');
        }
        setConflictContext({ id, start, end, staffId });
        return; // abort optimistic update
      }
      if (!resp.ok) throw new Error('Failed reschedule');
      // optimistic merge across bookings lists
      qc.setQueriesData({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'bookings' }, (old: unknown) => {
        const list = (old as BookingEvent[]) || [];
        return list.map((ev: BookingEvent) => ev.id === id ? { ...ev, start, end, staffId } : ev);
      });
    } catch (e: unknown) {
      const error = e as Error;
      console.warn('Reschedule error', error);
      throw e;
    } finally {
      qc.invalidateQueries({ queryKey: ['bookings'] });
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-6">
      <aside className="hidden lg:block sticky top-4 self-start max-h-[calc(100vh-2rem)]">
        <div className="h-full overflow-y-auto overflow-x-hidden">
          <Sidebar />
        </div>
      </aside>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Schedule</h1>
          <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-1 bg-white border rounded">
              {(['calendar','list'] as const).map(m => (
                <button
                  key={m}
                  onClick={()=>setMode(m)}
                  className={`px-3 py-1 rounded-sm ${mode===m ? 'bg-indigo-600 text-white' : 'hover:bg-gray-50'}`}
                  aria-label={`switch-${m}-mode`}
                >{m}</button>
              ))}
            </div>
            {mode === 'calendar' && (
              <div className="flex items-center gap-2">
                {(['month','week','day'] as const).map(v => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`px-3 py-1 rounded border ${view===v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white hover:bg-gray-50'}`}
                    aria-label={`switch-${v}-view`}
                  >{v}</button>
                ))}
                <label className="flex items-center gap-1 cursor-pointer ml-2">
                  <input type="checkbox" checked={staffLanes} onChange={e=>setStaffLanes(e.target.checked)} />
                  <span>Staff lanes</span>
                </label>
              </div>
            )}
            <button onClick={()=>setOpenComposer(true)} className="px-3 py-1 rounded bg-green-600 text-white" aria-label="new-booking-btn">New Booking</button>
          </div>
        </div>

        {/* Content */}
        {mode === 'calendar' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Staff list */}
            <aside className="lg:col-span-3">
              <div className="bg-white border rounded p-3">
                <div className="text-sm font-medium mb-2">Staff</div>
                {staff.length === 0 ? (
                  <div className="text-xs text-gray-500">No staff available</div>
                ) : (
                  <ul className="space-y-2">
                    {staff.map((s: any) => (
                      <li key={s.id || s.user_id} className="flex items-center justify-between text-sm">
                        <span className="truncate">{s.name || s.email || s.id || s.user_id}</span>
                        <span className="text-[10px] text-gray-500 ml-2">{s.role || 'staff'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-4 bg-white border rounded p-3">
                <div className="text-sm font-medium mb-2">Services</div>
                {servicesLoading ? (
                  <div className="text-xs text-gray-500">Loading…</div>
                ) : (
                  <ul className="space-y-2">
                    {services.map((svc: any) => (
                      <li key={svc.id} className="flex items-center justify-between text-sm">
                        <span className="truncate">{svc.name}</span>
                        {svc.duration ? <span className="text-[10px] text-gray-500 ml-2">{svc.duration}m</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>

            {/* Calendar center */}
            <section className="lg:col-span-9">
              <h2 className="text-sm font-medium mb-2">Calendar ({view})</h2>
              {isLoading ? (
                <div className="p-4 text-gray-500 bg-white border rounded">Loading…</div>
              ) : (
                <Calendar
                  view={view}
                  events={events}
                  staffLanes={staffLanes}
                  onEventClick={(ev) => setActiveBooking(ev)}
                  onEventDrop={handleReschedule}
                  onRangeChange={(start, end) => {
                    // Avoid infinite loops: only update if changed
                    setRange(prev => (prev?.start === start && prev?.end === end) ? prev : { start, end });
                  }}
                  staffOptions={staff}
                />
              )}
            </section>
          </div>
        ) : (
          <div>
            <h2 className="text-sm font-medium mb-2">Reservations List</h2>
            <ReservationsList />
          </div>
        )}

        {openComposer && (
          <Modal open={openComposer} onClose={()=>setOpenComposer(false)}>
            <BookingComposer
              context={{ tenantId: 't1', prefill: { start: '', end: '' } }}
              onComplete={(bk) => {
                // On complete, refresh bookings queries in scope
                qc.invalidateQueries({ queryKey: ['bookings'] });
                setOpenComposer(false);
              }}
              onCancel={()=>setOpenComposer(false)}
            />
          </Modal>
        )}

        {activeBooking && (
          <BookingSidePanel
            booking={activeBooking}
            onClose={()=>setActiveBooking(null)}
            onUpdate={async (patch) => {
              // Patch visible bookings lists and refetch
              qc.setQueriesData({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'bookings' }, (old: unknown) => {
                const list = (old as any[]) || [];
                return list.map((ev: any) => ev.id === activeBooking.id ? { ...ev, ...patch } : ev);
              });
              qc.invalidateQueries({ queryKey: ['bookings'] });
            }}
          />
        )}
        {conflictContext && (
          <ConflictResolutionOverlay
            targetStart={conflictContext.start}
            targetEnd={conflictContext.end}
            staffId={conflictContext.staffId}
            conflicts={conflicts}
            source={conflictSource}
            onClose={()=>{ setConflictContext(null); setConflicts([]); }}
            onSelectAlternative={async (altStart, altEnd, staff) => {
              const { id } = conflictContext;
              setConflictContext(null);
              await handleReschedule(id, altStart, altEnd, staff);
            }}
          />
        )}
      </div>
    </div>
  );
}