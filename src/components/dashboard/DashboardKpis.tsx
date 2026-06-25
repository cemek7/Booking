"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useAuthHeaders } from '@/hooks/useAuthHeaders';
import type { DashboardMetric, StaffMemberMetric } from '@/types/analytics-api';
import type { Role } from '@/types/roles';

type Period = 'day' | 'week' | 'month' | 'quarter';

type SiasSummary = {
  open_escalations: number;
  pending_campaigns: number;
  retrying_campaigns: number;
  attribution_records: number;
  campaign_success_rate: number;
};

interface DashboardKpisProps {
  tenantId: string;
  userId: string;
  userRole: Role;
  period?: Period;
}

const PERIOD_DAYS: Record<Period, number> = {
  day: 1,
  week: 7,
  month: 30,
  quarter: 90,
};

const trendFromDelta = (delta?: number): 'up' | 'down' | 'flat' | undefined => {
  if (typeof delta !== 'number') return undefined;
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
};

// ── Metric-type accent colours ────────────────────────────────────────────────

type MetricId = string;

const METRIC_ACCENT: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  total_bookings: {
    bg: 'bg-indigo-50', text: 'text-indigo-600',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
        <path d="M5 2v2M11 2v2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M2 7h12" stroke="currentColor" strokeWidth="1.25" />
      </svg>
    ),
  },
  no_show_rate: {
    bg: 'bg-rose-50', text: 'text-rose-600',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.25" />
        <path d="M5.5 8h5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    ),
  },
  avg_booking_value: {
    bg: 'bg-emerald-50', text: 'text-emerald-600',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 11l4-4 3 2.5 3-5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  total_revenue: {
    bg: 'bg-emerald-50', text: 'text-emerald-600',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1.5" y="4" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
        <path d="M1.5 7h13" stroke="currentColor" strokeWidth="1.25" />
        <circle cx="8" cy="10" r="1.25" fill="currentColor" />
      </svg>
    ),
  },
  new_customers: {
    bg: 'bg-violet-50', text: 'text-violet-600',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="6.5" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.25" />
        <path d="M2 13.5c0-2.5 2-4.5 4.5-4.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M12 9v4M10 11h4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    ),
  },
  staff_utilization: {
    bg: 'bg-amber-50', text: 'text-amber-600',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.25" />
        <path d="M8 5v3.5l2 1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  my_completed_bookings: {
    bg: 'bg-indigo-50', text: 'text-indigo-600',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 8.5l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  my_revenue: {
    bg: 'bg-emerald-50', text: 'text-emerald-600',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1.5" y="4" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
        <path d="M1.5 7h13" stroke="currentColor" strokeWidth="1.25" />
        <circle cx="8" cy="10" r="1.25" fill="currentColor" />
      </svg>
    ),
  },
  my_tips: {
    bg: 'bg-teal-50', text: 'text-teal-600',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 2v12M5 5h4.5a2 2 0 010 4H5V5zM5 9h5a2 2 0 010 4H5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    ),
  },
  my_utilization: {
    bg: 'bg-amber-50', text: 'text-amber-600',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.25" />
        <path d="M8 5v3.5l2 1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  my_rating: {
    bg: 'bg-yellow-50', text: 'text-yellow-600',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 2l1.5 3.5 3.5.5-2.5 2.5.5 3.5L8 10.5l-3 1.5.5-3.5L3 6l3.5-.5L8 2z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      </svg>
    ),
  },
  my_avg_service_time: {
    bg: 'bg-sky-50', text: 'text-sky-600',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.25" />
        <path d="M8 5v3.5l2 1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
};

const DEFAULT_ACCENT = { bg: 'bg-gray-50', text: 'text-gray-500', icon: null };

// ── Inline polished KPI card ───────────────────────────────────────────────────

interface InternalKpiCardProps {
  id: MetricId;
  label: string;
  value: string;
  delta?: number;
  trend?: 'up' | 'down' | 'flat';
  ariaLabel?: string;
}

function KpiCard({ id, label, value, delta, trend, ariaLabel }: InternalKpiCardProps) {
  const accent = METRIC_ACCENT[id] ?? DEFAULT_ACCENT;
  const formattedDelta =
    typeof delta === 'number' && delta !== 0
      ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`
      : null;

  return (
    <div
      className="flex flex-col bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow"
      aria-label={ariaLabel ?? label}
    >
      {/* Icon badge */}
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-4 ${accent.bg} ${accent.text}`}>
        {accent.icon}
      </div>

      {/* Value */}
      <div className="text-[1.6rem] font-bold text-gray-900 leading-none tabular-nums">
        {value}
      </div>

      {/* Label */}
      <div className="mt-1 text-xs font-medium text-gray-400 uppercase tracking-wider leading-tight">
        {label}
      </div>

      {/* Trend badge */}
      {(formattedDelta || trend) && (
        <div className="mt-3 flex items-center gap-1">
          {trend === 'up' && (
            <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M5 7.5V2.5M2.5 5l2.5-2.5 2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {formattedDelta}
            </span>
          )}
          {trend === 'down' && (
            <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded-md">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M5 2.5v5M2.5 5l2.5 2.5 2.5-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {formattedDelta}
            </span>
          )}
          {trend === 'flat' && formattedDelta && (
            <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-md">
              {formattedDelta}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function KpiSkeleton() {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm animate-pulse">
      <div className="w-9 h-9 bg-gray-100 rounded-xl mb-4" />
      <div className="h-8 w-24 bg-gray-100 rounded mb-2" />
      <div className="h-3 w-20 bg-gray-100 rounded mb-3" />
      <div className="h-5 w-14 bg-gray-100 rounded" />
    </div>
  );
}

// ── Main component (data logic untouched) ─────────────────────────────────────

export default function DashboardKpis({
  tenantId,
  userId,
  userRole,
  period = 'day',
}: DashboardKpisProps) {
  const headers = useAuthHeaders();
  const [metrics, setMetrics] = useState<DashboardMetric[]>([]);
  const [siasSummary, setSiasSummary] = useState<SiasSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [currency, setCurrency] = useState('USD');

  const formatValue = (value: number, type: DashboardMetric['type']) => {
    switch (type) {
      case 'currency':
        return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
      case 'percentage':
        return `${value.toFixed(1)}%`;
      case 'duration':
        return `${value} mins`;
      case 'count':
      default:
        return value.toLocaleString();
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadTenantMetrics = async () => {
      setLoading(true);
      setFetchError(false);
      setSiasSummary(null);
      try {
        const scope = userRole === 'manager' ? 'team' : 'tenant';
        const res = await fetch(`/api/analytics/dashboard?period=${period}&scope=${scope}`, { headers: headers ?? {} });
        const data = res.ok ? await res.json() : null;
        if (!cancelled) {
          setMetrics(data?.metrics ?? []);
          setSiasSummary(data?.sias ?? null);
          if (typeof data?.currency === 'string' && data.currency.length === 3) {
            setCurrency(data.currency.toUpperCase());
          }
        }
      } catch {
        if (!cancelled) setFetchError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const loadStaffMetrics = async () => {
      setLoading(true);
      setFetchError(false);
      setSiasSummary(null);
      try {
        const res = await fetch(`/api/staff/metrics?days=${PERIOD_DAYS[period]}`, { headers: headers ?? {} });
        const data = res.ok ? await res.json() : null;
        const rows: StaffMemberMetric[] = data?.metrics ?? [];
        const row = rows.find((r) => r.user_id === userId) ?? rows[0];
        if (!cancelled && row) {
          if (typeof data?.currency === 'string' && data.currency.length === 3) {
            setCurrency(data.currency.toUpperCase());
          }
          const now = new Date().toISOString();
          const personalMetrics: DashboardMetric[] = [
            {
              id: 'my_completed_bookings',
              name: 'My Completed Bookings',
              value: row.completed ?? 0,
              trend: 0,
              type: 'count',
              period,
              last_updated: now,
            },
            {
              id: 'my_revenue',
              name: 'My Revenue',
              value: row.revenue ?? 0,
              trend: 0,
              type: 'currency',
              period,
              last_updated: now,
            },
            {
              id: 'my_tips',
              name: 'My Tips',
              value: row.tips_total ?? 0,
              trend: 0,
              type: 'currency',
              period,
              last_updated: now,
            },
            {
              id: 'my_utilization',
              name: 'My Utilization',
              value: row.utilization_rate ?? 0,
              trend: 0,
              type: 'percentage',
              period,
              last_updated: now,
            },
            {
              id: 'my_rating',
              name: 'My Rating',
              value: row.rating ?? 0,
              trend: 0,
              type: 'count',
              period,
              last_updated: now,
            },
            {
              id: 'my_avg_service_time',
              name: 'Avg Service Time',
              value: row.avg_service_duration_min ?? 0,
              trend: 0,
              type: 'duration',
              period,
              last_updated: now,
            },
          ];
          setMetrics(personalMetrics);
        }
      } catch {
        if (!cancelled) setFetchError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (!headers || !tenantId) return;

    if (userRole === 'staff') {
      loadStaffMetrics();
    } else {
      loadTenantMetrics();
    }

    return () => {
      cancelled = true;
    };
  }, [headers, tenantId, userId, userRole, period]);

  const metricMap = useMemo(() => {
    const map = new Map<string, DashboardMetric>();
    metrics.forEach((m) => map.set(m.id, m));
    return map;
  }, [metrics]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, idx) => (
          <KpiSkeleton key={idx} />
        ))}
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="flex-shrink-0">
          <path d="M8 2L14 13H2L8 2z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
          <path d="M8 6v3.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          <circle cx="8" cy="11" r="0.75" fill="currentColor" />
        </svg>
        <span>Could not load metrics — check your connection and refresh.</span>
      </div>
    );
  }

  const isStaff = userRole === 'staff';
  const cards = isStaff
    ? [
        { id: 'my_completed_bookings', label: 'Completed Bookings' },
        { id: 'my_revenue', label: 'My Revenue' },
        { id: 'my_tips', label: 'My Tips' },
        { id: 'my_utilization', label: 'My Utilization' },
        { id: 'my_rating', label: 'My Rating' },
        { id: 'my_avg_service_time', label: 'Avg Service Time' },
      ]
    : [
        { id: 'total_bookings', label: 'Bookings (24h)' },
        { id: 'no_show_rate', label: 'No-Show Rate' },
        { id: 'avg_booking_value', label: 'Avg Booking Value' },
        { id: 'total_revenue', label: 'Revenue (24h)' },
        { id: 'new_customers', label: 'New Customers' },
        { id: 'staff_utilization', label: 'Staff Utilization' },
      ];

  return (
    <div className="space-y-4">
      {!isStaff && siasSummary ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#edd7cb] bg-[#fff7f1] px-4 py-3 text-sm text-[#7d4a32]">
          <span className="font-semibold uppercase tracking-[0.18em] text-[10px] text-[#9a5f45]">SIAS</span>
          <span>{siasSummary.open_escalations} open escalations</span>
          <span>{siasSummary.pending_campaigns} pending campaigns</span>
          <span>{Math.round(siasSummary.campaign_success_rate)}% campaign success</span>
          <span>{siasSummary.attribution_records} attribution records</span>
        </div>
      ) : null}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {cards.map((card) => {
          const metric = metricMap.get(card.id);
          const value = metric ? formatValue(metric.value, metric.type) : '—';
          return (
            <KpiCard
              key={card.id}
              id={card.id}
              label={card.label}
              value={value}
              delta={metric?.trend}
              trend={trendFromDelta(metric?.trend)}
              ariaLabel={`${card.label} KPI`}
            />
          );
        })}
      </div>
    </div>
  );
}
