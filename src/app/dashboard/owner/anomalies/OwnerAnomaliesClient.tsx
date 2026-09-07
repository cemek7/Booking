'use client';

import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/auth/auth-api-client';
import { useAuthHeaders } from '@/hooks/useAuthHeaders';

type Anomaly = {
  id: string;
  rule_key: string;
  domain: 'service' | 'retail' | 'inventory';
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved' | 'dismissed' | 'false_positive';
  entity_type?: string | null;
  entity_id?: string | null;
  expected_value_cents?: number | null;
  actual_value_cents?: number | null;
  difference_cents?: number | null;
  assigned_to?: string | null;
  resolution_note?: string | null;
  last_seen_at?: string | null;
  detail?: Record<string, unknown>;
};

function formatMoney(cents: number | null | undefined) {
  return `₦${Math.round(Number(cents ?? 0) / 100).toLocaleString()}`;
}

function severityTone(severity: Anomaly['severity']) {
  if (severity === 'critical') return 'bg-rose-100 text-rose-800 border-rose-200';
  if (severity === 'high') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (severity === 'medium') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

export default function OwnerAnomaliesClient() {
  const headers = useAuthHeaders();
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [selected, setSelected] = useState<Anomaly | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');

  function selectAnomaly(anomaly: Anomaly | null) {
    setSelected(anomaly);
    setResolutionNote(anomaly?.resolution_note ?? '');
  }

  useEffect(() => {
    let active = true;
    if (!headers) return;

    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (severityFilter !== 'all') params.set('severity', severityFilter);
    if (domainFilter !== 'all') params.set('domain', domainFilter);

    authFetch<{ anomalies: Anomaly[] }>(`/api/owner/anomalies?${params.toString()}`, { headers })
      .then((res) => {
        if (!active) return;
        if (res.error) {
          setError(res.error.message);
          return;
        }
        const rows = (res.data?.anomalies ?? []) as Anomaly[];
        setAnomalies(rows);
        selectAnomaly(rows.find((row) => row.id === selected?.id) ?? rows[0] ?? null);
        setError(null);
      })
      .catch(() => {
        if (!active) return;
        setError('Failed to load anomalies');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [headers, statusFilter, severityFilter, domainFilter, selected?.id]);

  const totals = useMemo(() => {
    return anomalies.reduce(
      (summary, anomaly) => {
        summary.open += anomaly.status === 'open' || anomaly.status === 'investigating' ? 1 : 0;
        summary.atRisk += Math.abs(
          Number(
            anomaly.difference_cents ??
              anomaly.expected_value_cents ??
              anomaly.actual_value_cents ??
              0
          )
        );
        return summary;
      },
      { open: 0, atRisk: 0 }
    );
  }, [anomalies]);

  async function updateSelected(status: Anomaly['status']) {
    if (!selected || !headers) return;
    setSaving(true);
    const payload = {
      status,
      resolution_note: resolutionNote || null,
    };
    const response = await authFetch<{ anomaly: Anomaly }>(`/api/owner/anomalies/${selected.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(payload),
    });

    setSaving(false);
    if (response.error) {
      setError(response.error.message);
      return;
    }

    const next = response.data?.anomaly as Anomaly;
    setAnomalies((current) => current.map((row) => (row.id === next.id ? next : row)));
        selectAnomaly(next);
        setError(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Revenue assurance</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">Owner anomaly review</h1>
          <p className="mt-1 text-sm text-slate-600">
            Review exceptions before they become cash leakage, stock drift, or messy month-end cleanup.
          </p>
        </div>

        <div className="grid gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Open anomalies</p>
            <p className="mt-1 text-xl font-semibold text-slate-950">{totals.open}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Value at risk</p>
            <p className="mt-1 text-xl font-semibold text-rose-700">{formatMoney(totals.atRisk)}</p>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <select className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="open">Open</option>
          <option value="investigating">Investigating</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
          <option value="false_positive">False positive</option>
          <option value="all">All statuses</option>
        </select>
        <select className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
          <option value="all">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)}>
          <option value="all">All domains</option>
          <option value="service">Service</option>
          <option value="retail">Retail</option>
          <option value="inventory">Inventory</option>
        </select>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-950">Active queue</h2>
            <p className="text-sm text-slate-500">Newest anomalies first.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Rule</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Domain</th>
                  <th className="px-4 py-3">At risk</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td className="px-4 py-5 text-slate-500" colSpan={5}>Loading anomalies…</td></tr>
                ) : anomalies.length === 0 ? (
                  <tr><td className="px-4 py-5 text-slate-500" colSpan={5}>No anomalies match the current filters.</td></tr>
                ) : anomalies.map((anomaly) => (
                  <tr
                    key={anomaly.id}
                    className={`cursor-pointer transition hover:bg-slate-50 ${selected?.id === anomaly.id ? 'bg-slate-50' : ''}`}
                    onClick={() => selectAnomaly(anomaly)}
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">{anomaly.rule_key.replaceAll('_', ' ')}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${severityTone(anomaly.severity)}`}>
                        {anomaly.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-600">{anomaly.domain}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatMoney(
                        anomaly.difference_cents ??
                          anomaly.expected_value_cents ??
                          anomaly.actual_value_cents ??
                          0
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{anomaly.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Selected anomaly</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">
              {selected ? selected.rule_key.replaceAll('_', ' ') : 'Choose an anomaly'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Resolve it, dismiss it, or mark it as a false positive with an audit trail.
            </p>
          </div>

          {selected ? (
            <div className="mt-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Entity</p>
                  <p className="mt-2 text-sm font-medium text-slate-900">{selected.entity_type ?? '—'} / {selected.entity_id ?? '—'}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Last seen</p>
                  <p className="mt-2 text-sm font-medium text-slate-900">{selected.last_seen_at ? new Date(selected.last_seen_at).toLocaleString() : '—'}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Working note</p>
                <textarea
                  className="mt-3 min-h-[120px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none ring-0"
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  placeholder="Required when resolving, dismissing, or marking false positive."
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <button type="button" disabled={saving} onClick={() => updateSelected('investigating')} className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">
                  Mark investigating
                </button>
                <button type="button" disabled={saving} onClick={() => updateSelected('resolved')} className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                  Resolve
                </button>
                <button type="button" disabled={saving} onClick={() => updateSelected('dismissed')} className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700">
                  Dismiss
                </button>
                <button type="button" disabled={saving} onClick={() => updateSelected('false_positive')} className="rounded-2xl border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700">
                  False positive
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-sm text-slate-500">
              Pick an anomaly from the queue to review it here.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
