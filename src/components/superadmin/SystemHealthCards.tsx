"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { authFetch } from '@/lib/auth/auth-api-client';

type Kpi = {
  title: string;
  value: string | number;
  status: 'good' | 'warning' | 'critical';
  icon?: string;
};

type DashboardResponse = {
  kpis?: Kpi[];
  systemHealth?: {
    database?: {
      status?: 'healthy' | 'degraded' | 'critical' | 'unknown';
      query_latency_ms?: number;
      note?: string;
    };
    api?: {
      status?: 'healthy' | 'degraded' | 'critical' | 'unknown';
      request_count_5m?: number;
      error_rate_pct?: number;
      p95_latency_ms?: number;
      note?: string;
    };
    security?: {
      status?: 'healthy' | 'degraded' | 'critical' | 'unknown';
      active_incidents?: number;
      critical_incidents?: number;
      failed_auth_1h?: number;
      note?: string;
    };
  };
  lastUpdated?: string;
};

const statusColor = (status: Kpi['status']) => {
  switch (status) {
    case 'critical':
      return 'text-red-600';
    case 'warning':
      return 'text-amber-600';
    default:
      return 'text-green-600';
  }
};

const detailStatusColor = (status?: 'healthy' | 'degraded' | 'critical' | 'unknown') => {
  switch (status) {
    case 'critical':
      return 'text-red-600';
    case 'degraded':
      return 'text-amber-600';
    case 'healthy':
      return 'text-green-600';
    default:
      return 'text-gray-600';
  }
};

export default function SystemHealthCards() {
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [systemHealth, setSystemHealth] = useState<DashboardResponse['systemHealth'] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const res = await authFetch<DashboardResponse>('/api/superadmin/dashboard?range=24h');
        const data: DashboardResponse = res.status === 200 ? res.data || {} : {};
        if (!cancelled) {
          setKpis(data.kpis || []);
          setSystemHealth(data.systemHealth || null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <Card key={idx} className="animate-pulse">
            <CardContent className="p-4">
              <div className="h-3 w-24 bg-gray-200 rounded mb-3" />
              <div className="h-6 w-20 bg-gray-200 rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const top = kpis.slice(0, 4);
  const secondary = kpis.slice(4, 7);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {top.map((kpi) => (
          <Card key={kpi.title}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{kpi.title}</p>
                  <p className={`text-2xl font-bold ${statusColor(kpi.status)}`}>{kpi.value}</p>
                </div>
                <span className="text-2xl">{kpi.icon}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {secondary.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {secondary.map((kpi) => (
            <Card key={kpi.title}>
              <CardHeader>
                <CardTitle className="text-base">{kpi.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">
                  <span className={statusColor(kpi.status)}>{kpi.value}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {systemHealth && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Database</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className={`font-semibold ${detailStatusColor(systemHealth.database?.status)}`}>
                {String(systemHealth.database?.status || 'unknown').toUpperCase()}
              </div>
              {typeof systemHealth.database?.query_latency_ms === 'number' && (
                <div>Query latency: {systemHealth.database.query_latency_ms}ms</div>
              )}
              {systemHealth.database?.note && (
                <div className="text-muted-foreground">{systemHealth.database.note}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">API</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className={`font-semibold ${detailStatusColor(systemHealth.api?.status)}`}>
                {String(systemHealth.api?.status || 'unknown').toUpperCase()}
              </div>
              <div>Requests (5m): {systemHealth.api?.request_count_5m ?? 0}</div>
              <div>Error rate: {(systemHealth.api?.error_rate_pct ?? 0).toFixed(2)}%</div>
              {typeof systemHealth.api?.p95_latency_ms === 'number' && (
                <div>P95 latency: {systemHealth.api.p95_latency_ms}ms</div>
              )}
              {systemHealth.api?.note && (
                <div className="text-muted-foreground">{systemHealth.api.note}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Security</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className={`font-semibold ${detailStatusColor(systemHealth.security?.status)}`}>
                {String(systemHealth.security?.status || 'unknown').toUpperCase()}
              </div>
              <div>Active incidents: {systemHealth.security?.active_incidents ?? 0}</div>
              <div>Critical incidents: {systemHealth.security?.critical_incidents ?? 0}</div>
              {typeof systemHealth.security?.failed_auth_1h === 'number' && (
                <div>Failed auth (1h): {systemHealth.security.failed_auth_1h}</div>
              )}
              {systemHealth.security?.note && (
                <div className="text-muted-foreground">{systemHealth.security.note}</div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
