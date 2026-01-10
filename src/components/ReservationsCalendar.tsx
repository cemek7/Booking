"use client";
import { useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type SupabaseLite from '@/types/supabase';

type Reservation = {
  id: string;
  tenant_id?: string;
  customer_name?: string;
  phone?: string;
  service?: string;
  start_at?: string; // ISO
  end_at?: string;
  status?: string;
};

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function isoDateOnly(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

export default function ReservationsCalendar({ tenantId, onDayClick, selectedDate }: { tenantId: string; onDayClick?: (isoDate: string) => void; selectedDate?: string | undefined }) {
  const [date, setDate] = useState(new Date());
  const [reservations, setReservations] = useState<Reservation[]>([]);

  const monthRange = useMemo(() => {
    const start = startOfMonth(date);
    const end = endOfMonth(date);
    return { start, end };
  }, [date]);

    useEffect(() => {
      let mounted = true;
      const supabase = getBrowserSupabase() as unknown as SupabaseLite;
      async function load() {
        try {
          const { data } = await supabase
            .from<Reservation>('reservations')
            .select('*')
            .eq('tenant_id', tenantId)
            .gte('start_at', monthRange.start.toISOString())
            .lte('start_at', monthRange.end.toISOString())
            .order('start_at', { ascending: true });
          if (mounted && data) setReservations(data ?? []);
        } catch (err) {
          console.error('Failed to load reservations for calendar', err);
        }
      }
      load();

      // Subscribe to realtime changes if the runtime supabase client supports channels.
      let sub: unknown = null;
      try {
        if (typeof supabase.channel === 'function') {
          const ch = supabase.channel?.('public:reservations:calendar');
          if (ch && typeof ch.on === 'function') {
            ch.on('postgres_changes', { event: '*', schema: 'public', table: 'reservations', filter: `tenant_id=eq.${tenantId}` }, () => {
              load();
            });
          }
          if (ch && typeof ch.subscribe === 'function') ch.subscribe();
          sub = ch;
        }
      } catch (e) {
        console.warn('Realtime subscription failed (calendar)', e);
      }

      return () => {
        mounted = false;
        try {
          if (typeof supabase.removeChannel === 'function' && sub) supabase.removeChannel(sub);
        } catch {}
      };
    }, [tenantId, monthRange.start, monthRange.end]);

  // Map date -> reservations
  const byDate = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    for (const r of reservations) {
      const key = isoDateOnly(r.start_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return map;
  }, [reservations]);

  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

  const cells: Array<{ dayNumber?: number; iso?: string }> = [];
  for (let i = 0; i < firstDay; i++) cells.push({});
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(date.getFullYear(), date.getMonth(), d);
    cells.push({ dayNumber: d, iso: dt.toISOString().slice(0, 10) });
  }

  return (
    <div className="p-4 border rounded">
      <div className="flex items-center justify-between mb-3">
        <button className="px-2 py-1 border rounded" onClick={() => setDate(new Date(date.getFullYear(), date.getMonth() - 1, 1))}>Prev</button>
        <div className="font-semibold">{date.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</div>
        <button className="px-2 py-1 border rounded" onClick={() => setDate(new Date(date.getFullYear(), date.getMonth() + 1, 1))}>Next</button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-sm">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
          <div key={d} className="text-center font-medium">{d}</div>
        ))}
        {cells.map((c, idx) => {
          const isSelected = selectedDate && c.iso === selectedDate;
          return (
          <div key={idx} className={`h-24 p-1 border rounded bg-white ${isSelected ? 'ring-2 ring-indigo-300' : ''}`}>
            {c.dayNumber ? (
              <div>
                <button type="button" onClick={() => c.iso && onDayClick && onDayClick(c.iso)} className="w-full text-left">
                  <div className="text-xs text-gray-500">{c.dayNumber}</div>
                </button>
                <div className="mt-1 space-y-1 max-h-16 overflow-auto">
                  {c.iso && byDate.get(c.iso) ? byDate.get(c.iso)!.slice(0,3).map((r) => (
                    <div key={r.id} className="text-xs bg-indigo-50 rounded px-1 py-0.5">{r.service || r.customer_name || r.phone}</div>
                  )) : null}
                </div>
              </div>
            ) : null}
          </div>
        )})}
      </div>
    </div>
  );
}
