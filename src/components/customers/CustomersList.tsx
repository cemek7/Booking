"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useEffect } from 'react';
import { Table, THead, TBody, TR, TH, TD } from "../ui/table";
import Button from "../ui/button";
import Modal from '../ui/modal';
import CustomerProfileCard, { CustomerRow } from './CustomerProfileCard';
import ReservationForm from '../reservations/ReservationForm';
import { toast } from '../ui/toast';
import { useTenant } from "@/lib/supabase/tenant-context";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetch, authDelete, authPost } from "@/lib/auth/auth-api-client";

export default function CustomersList({ tenantId, filter }: { tenantId?: string; filter?: string }) {
  const { tenant } = useTenant();
  const effectiveTenantId = tenantId || tenant?.id;
  const qc = useQueryClient();
  const router = useRouter();
  // Listen for global refresh events triggered by ClientsPage
  useEffect(() => {
    const handler = () => qc.invalidateQueries({ queryKey: ['customers', effectiveTenantId] });
    window.addEventListener('customers:refresh', handler as EventListener);
    return () => window.removeEventListener('customers:refresh', handler as EventListener);
  }, [qc, effectiveTenantId]);
  const [selected, setSelected] = useState<CustomerRow | null>(null);
  const [open, setOpen] = useState(false);
  const [openBooking, setOpenBooking] = useState(false);
  const [selectedStats, setSelectedStats] = useState<{ totalBookings?: number; lastBookingAt?: string | null; status?: string } | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<{ lifetimeSpend?: number; recent?: Array<{ id: string; start_at?: string; status?: string; total?: number }> } | null>(null);
  const { data, error, isLoading } = useQuery({
    queryKey: ['customers', effectiveTenantId],
    queryFn: async () => {
      if (!effectiveTenantId) return [];
      const response = await authFetch('/api/customers');
      if (response.error) throw new Error('Failed customers fetch');
      return response.data || [];
    },
    enabled: !!effectiveTenantId
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await authDelete(`/api/customers?id=eq.${id}`);
      if (response.error) throw new Error('Delete failed');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers', effectiveTenantId] }),
    onError: () => toast.error('Failed to delete customer')
  });

  const handleEdit = (id: number) => {
    router.push(`/dashboard/customers/${id}`);
  };

  const handleDelete = (id: number) => {
    if (!confirm('Are you sure you want to delete this customer?')) return;
    deleteMutation.mutate(id);
  };

  const filtered: CustomerRow[] = useMemo(() => (data || []).filter((c: CustomerRow) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.phone && c.phone.toLowerCase().includes(q)) ||
      String(c.id).includes(q)
    );
  }), [data, filter]);

  if (isLoading) return <p>Loading...</p>;
  if (error) return <p>Error loading customers.</p>;

  return (
    <div className="overflow-x-auto">
      <Table>
        <THead>
          <TR>
            <TH>ID</TH>
            <TH>Name</TH>
            <TH>Phone</TH>
            <TH>Notes</TH>
            <TH>Created At</TH>
            <TH>&nbsp;</TH>
          </TR>
        </THead>
        <TBody>
          {filtered && filtered.length > 0 ? (
            filtered.map((c: CustomerRow) => (
              <TR key={c.id} className="cursor-pointer hover:bg-indigo-50" onClick={() => {
                setSelected(c);
                setOpen(true);
                // Best-effort stats fetch
                (async () => {
                  try {
                    const response = await authFetch(`/api/customers/${c.id}/stats`);
                    if (response.error) { setSelectedStats(null); return; }
                    const json = response.data;
                    setSelectedStats({
                      totalBookings: json.totalBookings ?? json.total_bookings,
                      lastBookingAt: json.lastBookingAt ?? json.last_booking_at,
                      status: json.status ?? json.tier ?? undefined,
                    });
                  } catch { setSelectedStats(null); }
                })();
                // Best-effort history fetch
                (async () => {
                  try {
                    const response = await authFetch(`/api/customers/${c.id}/history`);
                    if (response.error) { setSelectedHistory(null); return; }
                    const json = response.data;
                    setSelectedHistory({ lifetimeSpend: json.lifetimeSpend || 0, recent: Array.isArray(json.recent) ? json.recent : [] });
                  } catch { setSelectedHistory(null); }
                })();
              }}>
                <TD>{c.id}</TD>
                <TD>{c.name}</TD>
                <TD>{c.phone}</TD>
                <TD>{c.notes}</TD>
                <TD>{c.created_at ? new Date(c.created_at).toLocaleString() : ""}</TD>
                <TD onClick={e => e.stopPropagation()}>
                  <Button className="mr-2 px-2 py-1 text-xs" onClick={() => handleEdit(c.id)}>Edit</Button>
                  <Button className="px-2 py-1 text-xs bg-red-500 hover:bg-red-600" onClick={() => handleDelete(c.id)}>Delete</Button>
                </TD>
              </TR>
            ))
          ) : (
            <TR>
              <TD colSpan={6} className="text-center">{filter ? 'No matches.' : 'No customers found.'}</TD>
            </TR>
          )}
        </TBody>
      </Table>

      <Modal open={open} onClose={() => setOpen(false)}>
        {selected && (
          <CustomerProfileCard
            customer={{ ...selected, totalBookings: selectedStats?.totalBookings, lastBookingAt: selectedStats?.lastBookingAt, status: selectedStats?.status }}
            onEdit={(id) => { setOpen(false); handleEdit(id); }}
            onNewBooking={(id) => { setOpen(false); setOpenBooking(true); }}
            onMessage={async () => {
              setOpen(false);
              try {
                if (selected?.phone && effectiveTenantId) {
                  const response = await authPost(`/api/chats`, { phone: selected.phone });
                  if (response.error) {
                    router.push(`/chat?phone=${encodeURIComponent(selected.phone)}`);
                    return;
                  }
                  const data = response.data;
                  const chatId = data?.id || data?.[0]?.id;
                  if (chatId) { router.push(`/chat?chat=${encodeURIComponent(chatId)}`); return; }
                }
              } catch {}
              if (selected?.phone) router.push(`/chat?phone=${encodeURIComponent(selected.phone)}`); else router.push('/chat');
            }}
            lifetimeSpend={selectedHistory?.lifetimeSpend}
            recent={selectedHistory?.recent}
          />
        )}
      </Modal>

      <Modal open={openBooking} onClose={() => setOpenBooking(false)}>
        <div className="w-[420px] max-w-[95vw]">
          <h3 className="text-base font-semibold mb-3">New Booking</h3>
          <ReservationForm
            initialData={{ customer_id: selected?.id, date: '', services: [] }}
            onSuccess={() => {
              setOpenBooking(false);
              qc.invalidateQueries({ queryKey: ['bookings-list', effectiveTenantId] });
            }}
          />
        </div>
      </Modal>
    </div>
  );
}
