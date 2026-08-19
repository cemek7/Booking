"use client";

export const dynamic = 'force-dynamic';
import React, { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useBookings } from '@/hooks/useBookings';
import { ReservationsTable } from '@/components/reservations/ReservationsTable';
import RoleGuard from '@/components/RoleGuard';

function ReservationsPageInner() {
  const params = useSearchParams();
  const { start, end } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
    return { start, end };
  }, []);
  const { data, isLoading, error } = useBookings({ start, end });

  return (
    <RoleGuard allowedRoles={['owner','manager','staff']}>
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-3">Reservations</h1>
      {isLoading && <div className="text-sm text-gray-500">Loading…</div>}
      {error && <div className="text-sm text-red-600">Failed to load reservations.</div>}
      {data && (
        <ReservationsTable
          reservations={data}
          selectable
          onBulkAction={async (action, ids) => {
            console.log('bulk', action, ids);
          }}
          onRowClick={(r) => console.log('row', r.id)}
        />
      )}
    </div>
    </RoleGuard>
  );
}

export default function ReservationsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading…</div>}>
      <ReservationsPageInner />
    </Suspense>
  );
}
