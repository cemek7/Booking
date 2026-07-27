"use client";
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { bookingActionSchema } from '@/lib/validation';
import { authFetch } from '@/lib/auth/auth-api-client';

export function useBookingActions(id: string, locationId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { action: 'confirm'|'cancel'|'reschedule'|'mark_paid'; payload?: any }) => {
      const parsed = bookingActionSchema.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'Invalid action');
      const res = await authFetch(`/api/bookings/${id}/actions`, { method: 'POST', body: parsed.data });
      if (res.error) throw new Error(res.error.message || 'Failed booking action');
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['booking', id] });
      if (locationId) qc.invalidateQueries({ queryKey: ['bookings', locationId] });
    }
  });
}
