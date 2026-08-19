"use client";
import { useEffect } from 'react';
import { useRealtimeClient } from '@/hooks/useRealtimeClient';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeEvent } from '@/lib/realtimeClient';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export default function RealtimeSubscriptions() {
  const { subscribe } = useRealtimeClient();
  const qc = useQueryClient();

  useEffect(() => {
    const unsubAll: Array<() => void> = [];

    const onBookingEvent = (event: RealtimeEvent) => {
      const nestedData = asRecord(event.data);
      const update = asRecord(event.booking) ?? nestedData ?? event;
      const id = typeof event.id === 'string'
        ? event.id
        : typeof event.bookingId === 'string'
          ? event.bookingId
          : typeof nestedData?.id === 'string'
            ? nestedData.id
            : null;
      if (id) {
        qc.setQueryData<Record<string, unknown>>(['booking', id], (previous) => ({ ...(previous ?? {}), ...update }));
        // Update any cached bookings lists
        qc.setQueriesData({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'bookings' }, (old: unknown) => {
          const list = Array.isArray(old) ? old : [];
          return list.map((item) => {
            const booking = asRecord(item);
            return booking?.id === id ? { ...booking, ...update } : item;
          });
        });
      }
      // Invalidate broad schedule/bookings queries
      qc.invalidateQueries({ queryKey: ['schedule-events'] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
      if (id) qc.invalidateQueries({ queryKey: ['booking', id] });
      // Also nudge reservations list if present
      qc.invalidateQueries({ queryKey: ['reservations'] });
    };

    const onPaymentEvent = () => {
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
