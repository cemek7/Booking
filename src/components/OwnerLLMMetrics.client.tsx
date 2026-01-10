"use client";
import React, { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth/auth-api-client';

type MetricsResponse = { requests: number; total_tokens: number; cost: number } | { data: any[] } | { error?: string };

export default function OwnerLLMMetrics({ tenantId }: { tenantId: string }) {
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchUsage() {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/admin/llm-usage?tenant_id=${encodeURIComponent(tenantId)}`;
      const r = await authFetch(url);
      if (r.status !== 200) throw new Error(r.error?.message || 'failed');
      setMetrics(r.data as MetricsResponse);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function fetchGlobalMetrics() {
    setLoading(true);
    setError(null);
    try {
      const r = await authFetch('/api/admin/metrics');
      if (r.status !== 200) throw new Error(r.error?.message || 'failed');
      setMetrics(r.data as MetricsResponse);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!tenantId) return;
    fetchUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  return (
    <div>
      <h3>LLM Metrics</h3>
      <div style={{ marginBottom: 8 }}>
        <button onClick={fetchUsage} disabled={loading || !tenantId} style={{ marginRight: 8 }}>
          Refresh tenant usage
        </button>
        <button onClick={fetchGlobalMetrics} disabled={loading}>
          Refresh global metrics
        </button>
      </div>
      {loading && <div>Loading…</div>}
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <pre style={{ whiteSpace: 'pre-wrap', background: '#f7f7f7', padding: 8 }}>{JSON.stringify(metrics, null, 2)}</pre>
    </div>
  );
}
