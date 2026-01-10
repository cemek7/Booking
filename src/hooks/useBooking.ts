"use client";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BookingEvent } from '@/components/Calendar';

async function fetchBooking(id: string): Promise<BookingEvent | null> {
  const res = await fetch(`/api/bookings/${id}`);
  if (!res.ok) throw new Error('Failed booking fetch');
  const json = await res.json();
  return json.booking || null;
}

export function useBooking(id: string) {
  return useQuery({ queryKey: ['booking', id], queryFn: () => fetchBooking(id), enabled: !!id });
}

export function useUpdateBooking(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<BookingEvent>) => {
      const res = await fetch(`/api/bookings/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      if (!res.ok) throw new Error('Failed update booking');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['booking', id] });
    }
  });
}
