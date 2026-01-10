"use client";

import React from 'react';
import { useSearchParams } from 'next/navigation';
import ReservationLogs from '../../../components/ReservationLogs';

export default function Page() {
  const sp = useSearchParams();
  const reservationId = sp?.get('reservation_id') || undefined;
  const tenantId = sp?.get('tenant_id') || undefined;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Reservation Audit Logs</h1>
      <p className="text-sm text-gray-600 mb-4">Use query params <code>?reservation_id=...&tenant_id=...</code> to filter.</p>
      <ReservationLogs reservationId={reservationId} tenantId={tenantId} />
    </div>
  );
}
