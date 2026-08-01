'use client';

import { useEffect, useMemo, useState } from 'react';
import { authFetch, authPost } from '@/lib/auth/auth-api-client';
import { useTenantCurrency } from '@/hooks/useTenantCurrency';

interface LinkRow {
  id: string;
  amount: number;
  currency: string;
  status: string;
  provider_reference: string;
  created_at: string;
  raw?: { description?: string; payment_url?: string } | null;
}
interface CreateResult { paymentUrl: string; reference: string; amount: number; currency: string }

export default function PaymentLinksPage() {
  const { format } = useTenantCurrency();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateResult | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);

  async function loadLinks() {
    const res = await authFetch<{ links?: LinkRow[] }>('/api/payments/links');
    setLinks(res.data?.links ?? []);
  }
  useEffect(() => { void loadLinks(); }, []);

  const canCreate = useMemo(() => Number(amount) > 0 && description.trim().length > 0, [amount, description]);

  async function create() {
    setCreating(true); setError(null); setCreated(null);
    const res = await authPost<CreateResult>('/api/payments/links', {
      amount: Number(amount),
      description: description.trim(),
      customer_email: email.trim() || undefined,
      customer_phone: phone.trim() || undefined,
    });
    setCreating(false);
    if (res.error || !res.data) { setError(res.error?.message || 'Could not create the link.'); return; }
    setCreated(res.data);
    setAmount(''); setDescription(''); setEmail(''); setPhone('');
    void loadLinks();
  }

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-gray-900">Payment links</h1>
      <p className="text-sm text-gray-500">Charge a customer any amount — send them a secure Paystack link over WhatsApp, SMS or email.</p>

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
        {/* Create */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">New link</h2>
          <div className="mt-3 space-y-3">
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Amount" inputMode="decimal" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's it for? (e.g. Deposit for June event)" maxLength={200} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Customer email (optional)" inputMode="email" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" inputMode="tel" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button onClick={create} disabled={!canCreate || creating} className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">
              {creating ? 'Creating…' : 'Create link'}
            </button>
          </div>

          {created && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-medium text-emerald-800">Link ready for {format(created.amount)} — share it:</p>
              <div className="mt-1 flex items-center gap-2">
                <input readOnly value={created.paymentUrl} className="min-w-0 flex-1 truncate rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs" />
                <button onClick={() => navigator.clipboard?.writeText(created.paymentUrl)} className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white">Copy</button>
              </div>
            </div>
          )}
        </div>

        {/* Recent */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">Recent links</h2>
          {links.length === 0 ? (
            <p className="mt-3 text-sm text-gray-400">No payment links yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-100">
              {links.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{l.raw?.description || 'Payment'}</p>
                    <p className="text-xs text-gray-400">{format(Number(l.amount))} · <span className="capitalize">{l.status}</span></p>
                  </div>
                  {l.raw?.payment_url && (
                    <button onClick={() => navigator.clipboard?.writeText(l.raw!.payment_url!)} className="whitespace-nowrap rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200">Copy link</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
