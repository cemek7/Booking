'use client';

import React, { useState, useEffect } from 'react';
import { useAuthHeaders } from '@/hooks/useAuthHeaders';

interface StaffPerformance {
  staff_id: string;
  name: string;
  bookings_completed: number;
  bookings_cancelled: number;
  avg_rating?: number;
  utilization_rate?: number;
  period: string;
}

export default function ManagerReports() {
  const headers = useAuthHeaders();
  const [performance, setPerformance] = useState<StaffPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<'week' | 'month' | 'quarter'>('month');

  useEffect(() => {
    let active = true;
    if (!headers) {
      queueMicrotask(() => {
        if (!active) return;
        setLoading(false);
        setError('Unable to load your session. Refresh or sign in again.');
      });
      return () => { active = false; };
    }

    fetch(`/api/analytics/staff?period=${period}`, { headers })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        setPerformance(data?.performance ?? []);
        setError(null);
      })
      .catch(() => {
        if (!active) return;
        setError('Failed to load staff performance data');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => { active = false; };
  }, [headers, period]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Manager Reports</h1>
        <select
          value={period}
          onChange={(e) => {
            setLoading(true);
            setPeriod(e.target.value as 'week' | 'month' | 'quarter');
          }}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="quarter">This Quarter</option>
        </select>
      </div>
      <p className="text-sm text-muted-foreground mb-6">Operational and team performance reports.</p>

      <div className="border rounded-xl overflow-hidden">
        <div className="bg-gray-50 px-4 py-3 border-b">
          <h2 className="text-sm font-semibold text-gray-700">Team Performance</h2>
        </div>
        {loading && <p className="p-4 text-sm text-gray-400">Loading…</p>}
        {error && <p className="p-4 text-sm text-red-500">{error}</p>}
        {!loading && !error && performance.length === 0 && (
          <p className="p-4 text-sm text-gray-500">No performance data available for this period.</p>
        )}
        {!loading && !error && performance.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left px-4 py-2 font-medium text-gray-600">Staff</th>
                <th className="text-right px-4 py-2 font-medium text-gray-600">Completed</th>
                <th className="text-right px-4 py-2 font-medium text-gray-600">Cancelled</th>
                <th className="text-right px-4 py-2 font-medium text-gray-600">Utilization</th>
                <th className="text-right px-4 py-2 font-medium text-gray-600">Avg Rating</th>
              </tr>
            </thead>
            <tbody>
              {performance.map((s) => (
                <tr key={s.staff_id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name || s.staff_id}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{s.bookings_completed}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{s.bookings_cancelled}</td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {s.utilization_rate != null ? `${(s.utilization_rate * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {s.avg_rating != null ? s.avg_rating.toFixed(1) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
