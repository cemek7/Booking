"use client";

import { useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type SupabaseLite from '@/types/supabase';

type Props = {
  tenantId: string;
  defaultDateIso?: string; // YYYY-MM-DD
  onCreated?: (id: string) => void;
};

export default function ReservationForm({ tenantId, defaultDateIso, onCreated }: Props) {
  const supabase = getSupabaseBrowserClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [service, setService] = useState('');
  const [startAt, setStartAt] = useState(defaultDateIso ? `${defaultDateIso}T09:00` : '');
  const [duration, setDuration] = useState<number>(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Simple conflict check: call server-side create endpoint which performs robust checks
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        setError('Please sign in before creating reservations');
        setLoading(false);
        return;
      }

      const payload = {
        tenant_id: tenantId,
        customer_name: name,
        phone,
        service,
        start_at: new Date(startAt).toISOString(),
        duration_minutes: duration,
      };

      const resp = await fetch('/api/reservations/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const body = await resp.json().catch(() => ({})) as { id?: string; error?: string };
      if (!resp.ok) {
        setError(body.error || 'Failed to create reservation');
        setLoading(false);
        return;
      }

  const id = body.id;
      setName(''); setPhone(''); setService(''); setStartAt(defaultDateIso ? `${defaultDateIso}T09:00` : '');
      setLoading(false);
      if (onCreated && id) onCreated(id);
    } catch (err) {
      console.error('create reservation error', err);
      const message = err && typeof err === 'object' && 'message' in err ? (err as { message?: string }).message : String(err);
      setError(message || 'Failed to create reservation');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-3 border rounded space-y-2 bg-white">
      <div>
        <label className="text-sm">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border rounded px-2 py-1" />
      </div>
      <div>
        <label className="text-sm">Phone</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border rounded px-2 py-1" />
      </div>
      <div>
        <label className="text-sm">Service</label>
        <input value={service} onChange={(e) => setService(e.target.value)} className="w-full border rounded px-2 py-1" />
      </div>
      <div>
        <label className="text-sm">Start</label>
        <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="w-full border rounded px-2 py-1" />
      </div>
      <div>
        <label className="text-sm">Duration (minutes)</label>
        <input type="number" min={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-full border rounded px-2 py-1" />
      </div>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      <div className="flex justify-end">
        <button className="px-3 py-1 bg-indigo-600 text-white rounded" disabled={loading}>{loading ? 'Saving...' : 'Create'}</button>
      </div>
    </form>
  );
}
