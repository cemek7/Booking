"use client";

import React, { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth/auth-api-client';


type LogEntry = {
  id: string;
  reservation_id: string | null;
  tenant_id: string;
  action: string;
  actor: { id?: string; role?: string } | unknown;
  notes?: string | null;
  metadata?: unknown;
  created_at: string;
};

export default function ReservationLogs({ reservationId, tenantId }: { reservationId?: string; tenantId?: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (reservationId) params.set('reservation_id', reservationId);
      if (tenantId) params.set('tenant_id', tenantId);

      try {
        const res = await authFetch('/api/admin/reservation-logs?' + params.toString());

        if (res.status !== 200) {
          setError(res.error?.message || 'Failed to load logs');
          setLoading(false);
          return;
        }

        const payload = res.data as any;
        if (mounted) setLogs(payload.data || []);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg || 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [reservationId, tenantId]);

  if (loading) return <div>Loading logs...</div>;
  if (error) return <div className="text-red-600">Error: {error}</div>;
  if (!logs.length) return <div>No logs found.</div>;

  return (
    <div className="overflow-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Date</th>
            <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Action</th>
            <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Actor</th>
            <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Notes</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {logs.map((l) => (
            <tr key={l.id}>
              <td className="px-3 py-2 text-sm text-gray-700">{new Date(l.created_at).toLocaleString()}</td>
              <td className="px-3 py-2 text-sm text-gray-700">{l.action}</td>
              <td className="px-3 py-2 text-sm text-gray-700">
                <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(l.actor)}</pre>
              </td>
              <td className="px-3 py-2 text-sm text-gray-700">{l.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
