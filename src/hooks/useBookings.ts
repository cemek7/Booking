"use client";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BookingEvent } from '@/components/Calendar';
import { bookingCreateSchema, type BookingCreate } from '@/lib/validation';

interface BookingsParams { start: string; end: string; staffId?: string; }

async function fetchBookings({ start, end, staffId }: BookingsParams): Promise<BookingEvent[]> {
  const qp = new URLSearchParams({ start, end });
  if (staffId) qp.set('staff_id', staffId);
  const url = `/api/bookings?${qp.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed bookings fetch');
  const json = await res.json();
  return json.bookings || [];
}

export function useBookings(params: BookingsParams) {
  return useQuery({ queryKey: ['bookings', params.start, params.end, params.staffId], queryFn: () => fetchBookings(params), enabled: !!params.start && !!params.end });
}

export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: BookingCreate & { tenant_id: string }) => {
      const { tenant_id, ...payload } = body as any;
      const parsed = bookingCreateSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || 'Invalid booking payload');
      }
      const res = await fetch(`/api/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, tenant_id }) });
      if (!res.ok) throw new Error('Failed create booking');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
    }
  });
}
