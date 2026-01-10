"use client";
import { useEffect } from 'react';
import { useRealtimeClient } from '@/hooks/useRealtimeClient';
import { useQueryClient } from '@tanstack/react-query';

export default function RealtimeSubscriptions() {
  const { subscribe } = useRealtimeClient();
  const qc = useQueryClient();

  useEffect(() => {
    const unsubAll: Array<() => void> = [];

    const onBookingEvent = (e: any) => {
      const id = e?.id || e?.bookingId || e?.data?.id;
      const update = e?.booking || e?.data || e;
      if (id) {
        qc.setQueryData(['booking', id], (prev: any) => ({ ...(prev || {}), ...(update || {}) }));
        // Update any cached bookings lists
        qc.setQueriesData({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'bookings' }, (old: unknown) => {
          const list = (old as any[]) || [];
          return list.map((ev: any) => ev?.id === id ? { ...ev, ...update } : ev);
        });
      }
      // Invalidate broad schedule/bookings queries
      qc.invalidateQueries({ queryKey: ['schedule-events'] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
      if (id) qc.invalidateQueries({ queryKey: ['booking', id] });
      // Also nudge reservations list if present
      qc.invalidateQueries({ queryKey: ['reservations'] });
    };

    const onPaymentEvent = (_e: any) => {
      // If billing queries exist later, invalidate by key prefix
      qc.invalidateQueries({ predicate: (q) => {
        const key = q.queryKey[0];
        return key === 'billing' || key === 'invoices' || key === 'payments' || key === 'usage';
      }});
    };

    unsubAll.push(subscribe('booking.created', onBookingEvent));
    unsubAll.push(subscribe('booking.updated', onBookingEvent));
    unsubAll.push(subscribe('booking.deleted', onBookingEvent));
    unsubAll.push(subscribe('payment.updated', onPaymentEvent));

    return () => { unsubAll.forEach(fn => fn && fn()); };
  }, [qc, subscribe]);

  return null;
}
