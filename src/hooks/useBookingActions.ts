"use client";
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { bookingActionSchema } from '@/lib/validation';

export function useBookingActions(id: string, locationId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { action: 'confirm'|'cancel'|'reschedule'|'mark_paid'; payload?: any }) => {
      const parsed = bookingActionSchema.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'Invalid action');
      const res = await fetch(`/api/bookings/${id}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data) });
      if (!res.ok) throw new Error('Failed booking action');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['booking', id] });
      if (locationId) qc.invalidateQueries({ queryKey: ['bookings', locationId] });
    }
  });
}
