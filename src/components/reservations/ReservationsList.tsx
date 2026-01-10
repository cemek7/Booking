"use client";
import Link from "next/link";
import { useState } from "react";
import { toast } from "../ui/toast";
import { Table, THead, TBody, TR, TH, TD } from "../ui/table";
import Button from "../ui/button";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/auth-api-client';

async function fetchReservations(url: string) {
  const res = await authFetch(url);
  if (!res.status || res.status >= 400) throw new Error('Failed reservations fetch');
  return res.data;
}

interface ReservationsListProps {
  customerId?: string;
}

const ReservationsList: React.FC<ReservationsListProps> = ({ customerId }) => {
  // Build API URL based on whether customerId is provided
  const apiUrl = customerId ? `/api/reservations?customer_id=eq.${customerId}` : '/api/reservations';
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({ queryKey: ['reservations', customerId || 'all'], queryFn: () => fetchReservations(apiUrl) });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/api/reservations?id=eq.${id}`, { method: 'DELETE' });
      if (!res.status || res.status >= 400) throw new Error('Failed to delete reservation');
    },
    onSuccess: () => {
      toast.success('Reservation deleted');
      qc.invalidateQueries({ queryKey: ['reservations', customerId || 'all'] });
    },
    onError: (e: any) => toast.error(e.message || 'Delete failed')
  });

  const handleDelete = (id: string) => {
    if (!confirm('Delete this reservation?')) return;
    setDeletingId(id);
    deleteMutation.mutate(id, { onSettled: () => setDeletingId(null) });
  };

  if (isLoading) return <div className="p-4 text-gray-500 animate-pulse">Loading reservations…</div>;
  if (error) return <div className="p-4 text-red-600">Error loading reservations.</div>;

  return (
    <div>
      <Table>
        <THead>
          <TR>
            <TH>ID</TH>
            <TH>Status</TH>
            <TH>Customer</TH>
            <TH>Staff</TH>
            <TH>Date/Time</TH>
            <TH>Services</TH>
            <TH>Notes</TH>
            <TH>Created At</TH>
            <TH>&nbsp;</TH>
          </TR>
        </THead>
        <TBody>
          {data && data.length > 0 ? (
            data.map((r: any) => (
              <TR key={r.id}>
                <TD>
                  <Link href={`/dashboard/reservations/${r.id}`} className="text-blue-600 underline">
                    {r.id}
                  </Link>
                </TD>
                <TD>{r.status}</TD>
                <TD>{r.customer_id}</TD>
                <TD>{r.staff_id || '-'}</TD>
                <TD>{r.date ? new Date(r.date).toLocaleString() : '-'}</TD>
                <TD>
                  <ReservationServicesCell reservationId={r.id} />
                </TD>
                <TD>{r.notes}</TD>
                <TD>{r.created_at ? new Date(r.created_at).toLocaleString() : ""}</TD>
                <TD>
                  <Button
                    type="button"
                    className="px-2 py-1 text-xs bg-red-500 hover:bg-red-600"
                    onClick={() => handleDelete(r.id)}
                    disabled={deletingId === r.id}
                  >
                    {deletingId === r.id ? "Deleting..." : "Delete"}
                  </Button>
                </TD>
              </TR>
            ))
          ) : (
            <TR>
              <TD colSpan={9} className="text-center text-gray-400 py-8">No reservations found.<br /><span className="text-xs">Try adjusting your filters or add a new reservation.</span></TD>
            </TR>
          )}
        </TBody>
      </Table>
    </div>
  );
}

// Show services for a reservation
function ReservationServicesCell({ reservationId }: { reservationId: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['reservation-services', reservationId],
    queryFn: async () => {
      if (!reservationId) return [];
      const res = await fetch(`/api/reservations/${reservationId}/services`);
      if (!res.ok) throw new Error('Failed reservation services fetch');
      return res.json();
    },
    enabled: !!reservationId
  });
  if (isLoading) return <span>Loading...</span>;
  if (error) return <span>Error</span>;
  if (!data || data.length === 0) return <span>-</span>;
  return <span>{data.map((s: any) => `${s.service_id} (${s.quantity})`).join(', ')}</span>;
}

export default ReservationsList;
