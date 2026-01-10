"use client";
import React, { useEffect, useState } from 'react';

interface UsageDay { day: string; bookings: number; deposits: number; llm_tokens: number; }
interface Quota { allowed: boolean; reason?: string; remaining?: number | null; quota?: number | null; }

interface UsagePanelProps { tenantId: string; className?: string; }

export const UsagePanel: React.FC<UsagePanelProps> = ({ tenantId, className }) => {
  const [days, setDays] = useState<UsageDay[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTs, setRefreshTs] = useState<number>(Date.now());

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true); setError(null);
      try {
        const resp = await fetch(`/api/usage?tenant_id=${encodeURIComponent(tenantId)}&_=${refreshTs}`);
        if (!resp.ok) {
          setError(`Fetch failed: ${resp.status}`);
          setLoading(false); return;
        }
        const json = await resp.json().catch(() => ({}));
        if (!mounted) return;
        setDays(Array.isArray(json.window) ? json.window : []);
        setQuota(json.quota || null);
      } catch (e) {
        if (!mounted) return; setError('Network error');
      } finally { if (mounted) setLoading(false); }
    }
    load();
    return () => { mounted = false; };
  }, [tenantId, refreshTs]);

  return (
    <div className={"p-4 border rounded bg-white " + (className||'')}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-lg">Usage (7d)</h3>
        <button onClick={() => setRefreshTs(Date.now())} className="text-sm px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded" disabled={loading}>Refresh</button>
      </div>
      {loading && <div className="text-gray-500 animate-pulse">Loading usage…</div>}
      {error && <div className="text-red-600 mb-2">{error}</div>}
      {!loading && !error && days.length === 0 && <div className="text-gray-400 text-sm">No usage records yet.</div>}
      {!loading && !error && days.length > 0 && (
        <table className="w-full text-sm border mt-2">
          <thead>
            <tr className="bg-gray-50">
              <th className="p-1 border">Day</th>
              <th className="p-1 border">Bookings</th>
              <th className="p-1 border">Deposits</th>
              <th className="p-1 border">LLM Tokens</th>
            </tr>
          </thead>
          <tbody>
            {days.map(d => (
              <tr key={d.day}>
                <td className="p-1 border font-mono">{d.day}</td>
                <td className="p-1 border text-center">{d.bookings}</td>
                <td className="p-1 border text-center">{d.deposits}</td>
                <td className="p-1 border text-center">{d.llm_tokens}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-4 text-xs text-gray-600">
        <strong>Quota:</strong>{' '}
        {quota ? (
          quota.quota ? `${quota.remaining ?? 'n/a'} remaining of ${quota.quota}` : (quota.reason || 'no quota configured')
        ) : '—'}
      </div>
    </div>
  );
};

export default UsagePanel;
