"use client";

import React, { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth/auth-api-client';

type Props = { tenantId: string };

export default function TenantSettings({ tenantId }: Props) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [model, setModel] = useState('');
  const [rate, setRate] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const res = await authFetch(`/api/admin/tenant/${tenantId}/settings`, { method: 'GET' });
        if (res.status === 200) {
          const row = res.data as any;
          if (!mounted) return;
          setName(row?.name ?? '');
          setTimezone(row?.timezone ?? '');
          setModel(row?.preferred_llm_model ?? '');
          setRate(row?.llm_token_rate != null ? String(row.llm_token_rate) : '');
          setMessage(null);
        } else {
          // Fallback to localStorage best-effort so page still renders without auth
          const raw = typeof window !== 'undefined' ? localStorage.getItem('current_tenant') : null;
          const current = raw ? JSON.parse(raw) : null;
          if (!mounted) return;
          setName(current?.name ?? '');
          setTimezone(current?.timezone ?? '');
        }
      } catch (e) {
        console.warn('Failed to load tenant settings', e);
        if (!mounted) return;
        setMessage('Unable to load settings');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [tenantId]);

  function validate(): string | null {
    if (name.trim() === '') return 'Tenant name must not be empty';
    if (model.trim() === '') return 'Preferred model must not be empty';
    if (rate !== '') {
      const n = Number(rate);
      if (Number.isNaN(n) || n < 0) return 'Token rate must be a non-negative number';
    }
    return null;
  }

  async function save() {
    setMessage(null);
    const v = validate();
    if (v) {
      setMessage(v);
      return;
    }

    setLoading(true);
    try {
      const payload: Record<string, unknown> = { name: name.trim(), timezone: timezone.trim(), preferred_llm_model: model.trim() };
      if (rate !== '') payload.llm_token_rate = Number(rate);

      const resp = await authFetch(`/api/admin/tenant/${tenantId}/settings`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      if (resp.status !== 200) {
        setMessage('Failed to save: ' + (resp.error?.message || 'Unknown error'));
        setLoading(false);
        return;
      }

      setMessage('Saved');
    } catch (e) {
      console.warn('save failed', e);
      setMessage('Save failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 border rounded bg-white max-w-2xl">
      <h3 className="text-lg font-semibold mb-2">Tenant Settings</h3>
      {loading && <div className="mb-2">Loading…</div>}

      <div className="mb-3">
        <label className="block text-sm font-medium">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full rounded border px-2 py-1" />
      </div>

      <div className="mb-3">
        <label className="block text-sm font-medium">Timezone</label>
        <input value={timezone} onChange={(e) => setTimezone(e.target.value)} className="mt-1 block w-full rounded border px-2 py-1" />
      </div>

      <div className="mb-3">
        <label className="block text-sm font-medium">Preferred LLM model</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} className="mt-1 block w-full rounded border px-2 py-1" placeholder="e.g. gpt-4o-mini" />
      </div>

      <div className="mb-3">
        <label className="block text-sm font-medium">LLM token rate (currency/unit)</label>
        <input value={rate} onChange={(e) => setRate(e.target.value)} className="mt-1 block w-full rounded border px-2 py-1" placeholder="e.g. 0.000002" />
      </div>

      <div className="flex gap-2 items-center">
        <button disabled={loading} onClick={save} className="px-3 py-1 bg-blue-600 text-white rounded">Save</button>
        {message && <div className="text-sm">{message}</div>}
      </div>
    </div>
  );
}
