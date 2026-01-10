"use client";

import React, { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth/auth-api-client';

export default function TenantSettingsClient() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [model, setModel] = useState('');
  const [rate, setRate] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('current_tenant') : null;
      const current = raw ? JSON.parse(raw) : null;
      setTenantId(current?.id ?? null);
      setName(current?.name ?? '');
      setTimezone(current?.timezone ?? '');
    } catch (e) {
      // ignore
    }
  }, []);

  async function save() {
    setMessage(null);
    setLoading(true);
    try {
      if (!tenantId) {
        setMessage('No tenant selected');
        setLoading(false);
        return;
      }

      await authFetch(`/api/admin/tenant/${tenantId}/settings`, {
        method: 'PUT',
        body: JSON.stringify({ name, timezone, preferred_llm_model: model, llm_token_rate: rate === '' ? null : Number(rate) }),
      });
      setMessage('Save attempted');
    } catch (e) {
      console.warn('save failed', e);
      setMessage('Save failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 border rounded bg-white max-w-2xl">
      <h3 className="text-lg font-semibold mb-2">Tenant Settings (Client)</h3>

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
