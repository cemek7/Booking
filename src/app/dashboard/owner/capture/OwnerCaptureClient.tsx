'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/auth/auth-api-client';
import { useAuthHeaders } from '@/hooks/useAuthHeaders';

type CaptureItem = {
  id: string;
  status: 'pending' | 'processing' | 'review_required' | 'confirmed' | 'failed';
  error?: string | null;
  created_at?: string | null;
  media_inputs?: {
    id: string;
    kind: string;
    source?: string | null;
    storage_path?: string | null;
    metadata?: Record<string, unknown> | null;
  } | null;
  extracted_records?: Array<{
    id: string;
    record_type: string;
    fields: Record<string, unknown>;
    low_confidence_fields?: string[] | null;
    linked_record_type?: string | null;
    linked_record_id?: string | null;
  }> | null;
};

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return '{}';
  }
}

export default function OwnerCaptureClient() {
  const headers = useAuthHeaders();
  const [items, setItems] = useState<CaptureItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState<string>('{}');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    if (!headers) return;
    setLoading(true);
    const res = await authFetch<{ items: CaptureItem[] }>('/api/owner/capture', { headers });
    setLoading(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    const next = res.data?.items ?? [];
    setItems(next);
    setSelectedId((current) => current ?? next[0]?.id ?? null);
    setError(null);
  }, [headers]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );
  const extracted = selected?.extracted_records?.[0] ?? null;

  useEffect(() => {
    setFieldDraft(prettyJson(extracted?.fields ?? {}));
  }, [extracted?.fields, extracted?.id]);

  async function processQueue() {
    if (!headers) return;
    setProcessing(true);
    const res = await authFetch('/api/owner/capture/process', { method: 'POST', headers });
    setProcessing(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    await loadQueue();
  }

  async function saveFields() {
    if (!headers || !extracted) return;
    setSaving(true);
    try {
      const fields = JSON.parse(fieldDraft) as Record<string, unknown>;
      const res = await authFetch(`/api/owner/capture/${extracted.id}`, {
        method: 'PATCH',
        headers,
        body: { action: 'update', fields },
      });
      if (res.error) {
        setError(res.error.message);
        return;
      }
      await loadQueue();
      setError(null);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Invalid JSON');
    } finally {
      setSaving(false);
    }
  }

  async function confirmSelected() {
    if (!headers || !extracted) return;
    setConfirming(true);
    const res = await authFetch(`/api/owner/capture/${extracted.id}/confirm`, {
      method: 'POST',
      headers,
    });
    setConfirming(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    await loadQueue();
    setError(null);
  }

  async function rejectSelected() {
    if (!headers || !extracted) return;
    setRejecting(true);
    const res = await authFetch(`/api/owner/capture/${extracted.id}`, {
      method: 'PATCH',
      headers,
      body: { action: 'reject', note: 'Rejected from owner capture review queue' },
    });
    setRejecting(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    await loadQueue();
    setError(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Operational capture</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">Multimodal capture review</h1>
          <p className="mt-1 text-sm text-slate-600">
            Review receipts, stock sheets, voice notes, and service notes before Booka posts them into the ledger.
          </p>
        </div>
        <button
          type="button"
          onClick={processQueue}
          disabled={processing}
          className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {processing ? 'Processing…' : 'Process pending uploads'}
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-950">Queue</h2>
            <p className="text-sm text-slate-500">Pending, failed, and review-required capture jobs.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Kind</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td className="px-4 py-5 text-slate-500" colSpan={3}>Loading capture jobs…</td></tr>
                ) : items.length === 0 ? (
                  <tr><td className="px-4 py-5 text-slate-500" colSpan={3}>No capture jobs yet.</td></tr>
                ) : items.map((item) => (
                  <tr
                    key={item.id}
                    className={`cursor-pointer transition hover:bg-slate-50 ${selectedId === item.id ? 'bg-slate-50' : ''}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">{item.media_inputs?.kind ?? 'unknown'}</td>
                    <td className="px-4 py-3 text-slate-700">{item.status}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {item.created_at ? new Date(item.created_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Selected capture</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">
                {selected?.media_inputs?.kind ? selected.media_inputs.kind.replaceAll('_', ' ') : 'Choose a capture job'}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Edit the extracted fields if needed, then confirm or reject the proposal.
              </p>
            </div>
            {selected?.status ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                {selected.status}
              </span>
            ) : null}
          </div>

          {!selected ? (
            <div className="mt-6 text-sm text-slate-500">Select a capture job to review it.</div>
          ) : (
            <div className="mt-6 space-y-5">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Source</div>
                  <div className="mt-2 text-sm text-slate-700">{selected.media_inputs?.source ?? 'dashboard'}</div>
                  <div className="mt-2 break-all text-xs text-slate-500">{selected.media_inputs?.storage_path ?? '—'}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Record type</div>
                  <div className="mt-2 text-sm text-slate-700">{extracted?.record_type ?? 'Not extracted yet'}</div>
                  {selected.error ? <div className="mt-2 text-xs text-rose-600">{selected.error}</div> : null}
                </div>
              </div>

              {extracted?.low_confidence_fields?.length ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Low-confidence fields: {extracted.low_confidence_fields.join(', ')}
                </div>
              ) : null}

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-900">Extracted fields</label>
                <textarea
                  value={fieldDraft}
                  onChange={(event) => setFieldDraft(event.target.value)}
                  className="min-h-[320px] w-full rounded-2xl border border-slate-200 bg-slate-950 p-4 font-mono text-xs text-slate-100 outline-none ring-0"
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={saveFields}
                  disabled={!extracted || saving}
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save edits'}
                </button>
                <button
                  type="button"
                  onClick={confirmSelected}
                  disabled={!extracted || confirming}
                  className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {confirming ? 'Confirming…' : 'Confirm record'}
                </button>
                <button
                  type="button"
                  onClick={rejectSelected}
                  disabled={!extracted || rejecting}
                  className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {rejecting ? 'Rejecting…' : 'Reject'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
