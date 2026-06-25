"use client";
import React, { memo, useCallback } from 'react';
import { useRouter } from "next/navigation";
import { useMemo, useState, useEffect } from 'react';
import { Table, THead, TBody, TR, TH, TD } from "../ui/table";
import Button from "../ui/button";
import { Badge } from '../ui/badge';
import Modal from '../ui/modal';
import CustomerProfileCard, { CustomerRow } from './CustomerProfileCard';
import ReservationForm from '../reservations/ReservationForm';
import { toast } from '../ui/toast';
import { useTenant } from "@/lib/supabase/tenant-context";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetch, authDelete, authPost } from "@/lib/auth/auth-api-client";

interface CustomerListRowProps {
  customer: CustomerRow;
  onRowClick: (customer: CustomerRow) => void;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
}

type CustomerStatsPayload = {
  totalBookings?: number;
  total_bookings?: number;
  lastBookingAt?: string | null;
  last_booking_at?: string | null;
  status?: string;
  tier?: string;
};

type CustomerHistoryPayload = {
  lifetimeSpend?: number;
  recent?: Array<{ id: string; start_at?: string; status?: string; total?: number }>;
};

type ChatCreateResponse = {
  id?: string | number;
  data?: Array<{ id?: string | number }>;
};

const CustomerListRow = memo<CustomerListRowProps>(function CustomerListRow({
  customer,
  onRowClick,
  onEdit,
  onDelete,
}) {
  const handleRowClick = useCallback(() => {
    onRowClick(customer);
  }, [onRowClick, customer]);

  const handleEdit = useCallback(() => {
    onEdit(customer.id);
  }, [onEdit, customer.id]);

  const handleDelete = useCallback(() => {
    onDelete(customer.id);
  }, [onDelete, customer.id]);

  const handleActionClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <TR className="cursor-pointer hover:bg-slate-50" onClick={handleRowClick}>
      <TD className="font-medium text-slate-900">{customer.id}</TD>
      <TD className="font-medium text-slate-900">{customer.name}</TD>
      <TD className="font-mono text-slate-700">{customer.phone || '—'}</TD>
      <TD className="max-w-[28rem] whitespace-normal text-slate-600">{customer.notes || '—'}</TD>
      <TD>{customer.created_at ? new Date(customer.created_at).toLocaleString() : '—'}</TD>
      <TD onClick={handleActionClick}>
        <Button className="mr-2 px-2 py-1 text-xs" onClick={handleEdit}>Edit</Button>
        <Button className="px-2 py-1 text-xs bg-red-500 hover:bg-red-600" onClick={handleDelete}>Delete</Button>
      </TD>
    </TR>
  );
});

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
      const payload = response.data as unknown;
      if (Array.isArray(payload)) return payload;
      if (payload && typeof payload === 'object') {
        const nested = (payload as { data?: unknown }).data;
        if (Array.isArray(nested)) return nested;
      }
      return [];
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

  const handleEdit = useCallback((id: number) => {
    router.push(`/dashboard/customers/${id}`);
  }, [router]);

  const handleDelete = useCallback((id: number) => {
    if (!confirm('Are you sure you want to delete this customer?')) return;
    deleteMutation.mutate(id);
  }, [deleteMutation]);

  const handleRowClick = useCallback((c: CustomerRow) => {
    setSelected(c);
    setOpen(true);
    // Best-effort stats fetch
    (async () => {
      try {
        const response = await authFetch(`/api/customers/${c.id}/stats`);
        if (response.error) { setSelectedStats(null); return; }
        const json = response.data as CustomerStatsPayload;
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
        const json = response.data as CustomerHistoryPayload;
        setSelectedHistory({ lifetimeSpend: json.lifetimeSpend || 0, recent: Array.isArray(json.recent) ? json.recent : [] });
      } catch { setSelectedHistory(null); }
    })();
  }, []);

  const filtered: CustomerRow[] = useMemo(() => (data || []).filter((c: CustomerRow) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.phone && c.phone.toLowerCase().includes(q)) ||
      String(c.id).includes(q)
    );
  }), [data, filter]);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-sm text-slate-500 shadow-sm">
        Loading customers...
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-8 text-sm text-red-700 shadow-sm">
        Error loading customers.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Customers</h2>
          <p className="text-sm text-slate-500">Search, edit, and message customers without losing context.</p>
        </div>
        <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
          {filtered?.length ?? 0} customers
        </Badge>
      </div>
      <div className="overflow-x-auto">
        <Table className="min-w-[860px]">
          <THead>
            <TR>
              <TH className="w-16">ID</TH>
              <TH className="w-40">Name</TH>
              <TH className="w-36">Phone</TH>
              <TH className="min-w-[280px]">Notes</TH>
              <TH className="w-36">Created At</TH>
              <TH className="w-28">&nbsp;</TH>
            </TR>
          </THead>
          <TBody>
            {filtered && filtered.length > 0 ? (
              filtered.map((customer: CustomerRow) => (
                <CustomerListRow
                  key={customer.id}
                  customer={customer}
                  onRowClick={handleRowClick}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))
            ) : (
              <TR>
                <TD colSpan={6} className="text-center text-slate-500">{filter ? 'No matches.' : 'No customers found.'}</TD>
              </TR>
            )}
          </TBody>
        </Table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)}>
        {selected && (
          <CustomerProfileCard
            customer={{ ...selected, totalBookings: selectedStats?.totalBookings, lastBookingAt: selectedStats?.lastBookingAt, status: selectedStats?.status }}
            onEdit={(id) => { setOpen(false); handleEdit(id); }}
            onNewBooking={() => { setOpen(false); setOpenBooking(true); }}
            onMessage={async () => {
              setOpen(false);
              try {
                if (selected?.phone && effectiveTenantId) {
                  const response = await authPost(`/api/chats`, { phone: selected.phone });
                  if (response.error) {
                    router.push(`/chat?phone=${encodeURIComponent(selected.phone)}`);
                    return;
                  }
                  const data = response.data as ChatCreateResponse | Array<{ id?: string | number }>;
                  const chatId = Array.isArray(data) ? data[0]?.id : data?.id || data?.data?.[0]?.id;
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
