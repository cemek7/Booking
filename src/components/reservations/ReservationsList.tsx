"use client";
import { useState } from "react";
import { toast } from "../ui/toast";
import { Table, THead, TBody, TR, TH, TD } from "../ui/table";
import Button from "../ui/button";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/auth-api-client';

interface ReservationRow {
  id: string;
  status?: string | null;
  customer_number?: string | null;
  customer_name?: string | null;
  staff_id?: string | null;
  start_at?: string | null;
  notes?: string | null;
  created_at?: string | null;
}

type ReservationsResponse = { data?: ReservationRow[]; pagination?: { total?: number } };

async function fetchReservations(url: string): Promise<ReservationRow[]> {
  const res = await authFetch<ReservationsResponse>(url);
  if (!res.status || res.status >= 400) throw new Error('Failed reservations fetch');
  // The envelope is canonical; accept the legacy array briefly so older cached
  // clients and embedded consumers do not render an empty workspace mid-rollout.
  const payload = res.data as ReservationsResponse | ReservationRow[] | undefined;
  return Array.isArray(payload) ? payload : payload?.data ?? [];
}

interface ReservationsListProps {
  customerId?: string;
  tenantId?: string;
}

const ReservationsList: React.FC<ReservationsListProps> = ({ customerId, tenantId }) => {
  // Build API URL based on available filters
  const params = new URLSearchParams();
  if (customerId) params.set('customer_id', `eq.${customerId}`);
  if (tenantId) params.set('tenant_id', `eq.${tenantId}`);
  const apiUrl = `/api/reservations${params.toString() ? `?${params}` : ''}`;
  const qc = useQueryClient();
  const queryKey = ['reservations', tenantId || 'platform', customerId || 'all'];
  const { data, error, isLoading } = useQuery({ queryKey, queryFn: () => fetchReservations(apiUrl) });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/api/reservations/${id}`, { method: 'DELETE' });
      if (!res.status || res.status >= 400) throw new Error('Failed to delete reservation');
    },
    onSuccess: () => {
      toast.success('Reservation deleted');
      qc.invalidateQueries({ queryKey });
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : 'Delete failed')
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
            data.map((r) => (
              <TR key={r.id}>
                <TD>{r.status}</TD>
                <TD>{r.customer_number || r.customer_name || '—'}</TD>
                <TD>{r.staff_id ? 'Assigned' : 'Unassigned'}</TD>
                <TD>{r.start_at ? new Date(r.start_at).toLocaleString() : '-'}</TD>
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
              <TD colSpan={8} className="text-center text-gray-400 py-8">No reservations found.<br /><span className="text-xs">Try adjusting your filters or add a new reservation.</span></TD>
            </TR>
          )}
        </TBody>
      </Table>
    </div>
  );
}

// Show services for a reservation, by name (not internal UUID).
interface ReservationServiceLine { service_id: string; name: string; quantity: number; price: number | null }

function ReservationServicesCell({ reservationId }: { reservationId: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['reservation-services', reservationId],
    queryFn: async (): Promise<ReservationServiceLine[]> => {
      if (!reservationId) return [];
      const res = await authFetch<ReservationServiceLine[]>(`/api/reservations/${reservationId}/services`);
      if (res.error) throw new Error(res.error.message || 'Failed reservation services fetch');
      return res.data ?? [];
    },
    enabled: !!reservationId,
  });
  if (isLoading) return <span className="text-slate-400">…</span>;
  if (error) return <span className="text-slate-400">—</span>;
  if (!data || data.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <span>
      {data.map((s) => (s.quantity > 1 ? `${s.name} ×${s.quantity}` : s.name)).join(', ')}
    </span>
  );
}

export default ReservationsList;
