'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useAuthHeaders } from '@/hooks/useAuthHeaders';
import { useTenantCurrency } from '@/hooks/useTenantCurrency';
import type { DashboardMetric } from '@/types/analytics-api';

export default function OwnerReports() {
  const headers = useAuthHeaders();
  const { format: fmtMoney } = useTenantCurrency();
  const [metrics, setMetrics] = useState<DashboardMetric[]>([]);
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

    fetch(`/api/analytics/dashboard?period=${period}&scope=tenant`, { headers })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        setMetrics(data?.metrics ?? []);
        setError(null);
      })
      .catch(() => {
        if (!active) return;
        setError('Failed to load business metrics');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => { active = false; };
  }, [headers, period]);

  const metricById = useMemo(() => {
    const map = new Map<string, DashboardMetric>();
    metrics.forEach((m) => map.set(m.id, m));
    return map;
  }, [metrics]);

  const fmt = (n: number) => fmtMoney(n);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Owner Reports</h1>
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
      <p className="text-sm text-muted-foreground mb-6">Comprehensive financial and business performance reports.</p>

      {loading && <p className="text-sm text-gray-400">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!loading && !error && metrics.length === 0 && (
        <p className="text-sm text-gray-500">No data available for this period.</p>
      )}
      {!loading && !error && metrics.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            // Bookings
            { label: 'Total Bookings', value: metricById.get('total_bookings')?.value ?? '—' },
            { label: 'Booking Revenue', value: metricById.get('total_revenue')?.value != null ? fmt(metricById.get('total_revenue')!.value) : '—' },
            { label: 'Avg Booking Value', value: metricById.get('avg_booking_value')?.value != null ? fmt(metricById.get('avg_booking_value')!.value) : '—' },
            {
              label: 'Cancellation Rate',
              value: metricById.get('cancellation_rate')?.value != null ? `${metricById.get('cancellation_rate')!.value.toFixed(1)}%` : '—',
            },
            // Sales
            { label: 'Retail Orders', value: metricById.get('retail_orders')?.value ?? '—' },
            { label: 'Sales Revenue', value: metricById.get('sales_revenue')?.value != null ? fmt(metricById.get('sales_revenue')!.value) : '—' },
            // CRM
            { label: 'New Customers', value: metricById.get('new_customers')?.value ?? '—' },
            { label: 'New Leads', value: metricById.get('new_leads')?.value ?? '—' },
            // Inventory
            { label: 'Low-Stock Items', value: metricById.get('low_stock_items')?.value ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white border rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
              <p className="text-2xl font-semibold text-gray-900">{value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
