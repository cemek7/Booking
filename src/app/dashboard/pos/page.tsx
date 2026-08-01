'use client';

import { useEffect, useMemo, useState } from 'react';
import { authFetch, authPost } from '@/lib/auth/auth-api-client';
import { useTenantCurrency } from '@/hooks/useTenantCurrency';

interface PosProduct {
  id: string;
  name: string;
  price_cents: number;
  currency?: string;
  category?: string | null;
  sku?: string | null;
  track_inventory?: boolean;
  stock_quantity?: number | null;
  is_active?: boolean;
  images?: unknown;
}
type PayMethod = 'cash' | 'transfer' | 'card';
interface SaleResult { orderId: string; totalCents: number; itemCount: number; paid: boolean; paymentUrl: string | null }

export default function PosPage() {
  const { format } = useTenantCurrency();
  const money = (cents: number) => format(cents / 100);

  const [products, setProducts] = useState<PosProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [customer, setCustomer] = useState({ name: '', phone: '' });
  const [method, setMethod] = useState<PayMethod>('cash');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SaleResult | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await authFetch<{ products?: PosProduct[] }>('/api/products?limit=300&status=active');
      if (!active) return;
      setProducts(res.data?.products ?? []);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => {
    const t = search.trim().toLowerCase();
    return products.filter((p) => !t || p.name.toLowerCase().includes(t) || (p.sku ?? '').toLowerCase().includes(t));
  }, [products, search]);

  const lines = useMemo(
    () => products.map((p) => ({ p, q: cart[p.id] ?? 0 })).filter((l) => l.q > 0),
    [products, cart]
  );
  const totalCents = lines.reduce((s, l) => s + l.p.price_cents * l.q, 0);
  const itemCount = lines.reduce((s, l) => s + l.q, 0);

  function setQty(id: string, n: number) {
    setError(null);
    setCart((prev) => { const c = { ...prev }; if (n <= 0) delete c[id]; else c[id] = Math.min(n, 999); return c; });
  }
  function inStock(p: PosProduct) { return !p.track_inventory || Number(p.stock_quantity ?? 0) > 0; }

  function newSale() { setCart({}); setCustomer({ name: '', phone: '' }); setMethod('cash'); setReceipt(null); setError(null); }

  async function complete() {
    if (lines.length === 0) { setError('Add at least one item.'); return; }
    setSubmitting(true); setError(null);
    const res = await authPost<SaleResult>('/api/pos/sale', {
      items: lines.map((l) => ({ product_id: l.p.id, quantity: l.q })),
      paymentMethod: method,
      customer: (customer.name.trim() || customer.phone.trim()) ? { name: customer.name.trim() || undefined, phone: customer.phone.trim() || undefined } : undefined,
    });
    setSubmitting(false);
    if (res.error || !res.data) { setError(res.error?.message || 'Sale failed. Please try again.'); return; }
    setReceipt(res.data);
    // Refresh stock counts after a paid sale
    if (res.data.paid) {
      const r = await authFetch<{ products?: PosProduct[] }>('/api/products?limit=300&status=active');
      setProducts(r.data?.products ?? products);
    }
  }

  // ── Receipt ──
  if (receipt) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4 text-center">
        <div className={`flex h-14 w-14 items-center justify-center rounded-full text-2xl ${receipt.paid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {receipt.paid ? '✓' : '⏳'}
        </div>
        <h1 className="mt-4 text-2xl font-bold text-gray-900">{receipt.paid ? 'Sale complete' : 'Awaiting payment'}</h1>
        <p className="mt-1 text-sm text-gray-600">
          {receipt.itemCount} item{receipt.itemCount === 1 ? '' : 's'} · <span className="font-semibold text-gray-900">{money(receipt.totalCents)}</span>
        </p>
        {!receipt.paid && receipt.paymentUrl && (
          <div className="mt-5 w-full rounded-xl border border-gray-200 bg-gray-50 p-3 text-left">
            <p className="text-xs font-medium text-gray-500">Share this payment link with the customer:</p>
            <div className="mt-1 flex items-center gap-2">
              <input readOnly value={receipt.paymentUrl} className="min-w-0 flex-1 truncate rounded-md border border-gray-300 bg-white px-2 py-1 text-xs" />
              <button onClick={() => navigator.clipboard?.writeText(receipt.paymentUrl!)} className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white">Copy</button>
            </div>
            <a href={receipt.paymentUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-medium text-emerald-700">Open checkout ↗</a>
          </div>
        )}
        <p className="mt-4 text-xs text-gray-400">Order {receipt.orderId}</p>
        <button onClick={newSale} className="mt-6 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700">New sale</button>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-gray-900">Point of sale</h1>
      <p className="text-sm text-gray-500">Ring up a walk-in sale. Cash/transfer marks it paid and updates stock; card sends a Paystack link.</p>

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* ── Catalogue ── */}
        <div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products or SKU…" className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
          {loading ? (
            <p className="mt-6 text-sm text-gray-400">Loading products…</p>
          ) : products.length === 0 ? (
            <p className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">No products yet. Add products to sell them here.</p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {visible.map((p) => {
                const q = cart[p.id] ?? 0;
                const sold = !inStock(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={sold}
                    onClick={() => setQty(p.id, q + 1)}
                    className={`relative flex flex-col rounded-xl border bg-white p-3 text-left shadow-sm transition ${sold ? 'cursor-not-allowed opacity-50' : 'hover:border-emerald-400 hover:shadow'}`}
                  >
                    <span className="line-clamp-2 text-sm font-semibold text-gray-900">{p.name}</span>
                    <span className="mt-1 text-sm font-bold text-gray-900">{money(p.price_cents)}</span>
                    {p.track_inventory && <span className="mt-0.5 text-[11px] text-gray-400">{Number(p.stock_quantity ?? 0)} in stock</span>}
                    {q > 0 && <span className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1 text-[11px] font-bold text-white">{q}</span>}
                    {sold && <span className="absolute inset-x-0 bottom-2 text-center text-[11px] font-semibold uppercase text-red-500">Sold out</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Ticket ── */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">Current sale</h2>
            {lines.length === 0 ? (
              <p className="mt-4 text-sm text-gray-400">Tap products to add them.</p>
            ) : (
              <ul className="mt-3 divide-y divide-gray-100">
                {lines.map((l) => (
                  <li key={l.p.id} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{l.p.name}</span>
                    <button onClick={() => setQty(l.p.id, l.q - 1)} className="h-6 w-6 rounded-md bg-gray-100 text-gray-700">−</button>
                    <span className="w-5 text-center text-sm font-semibold">{l.q}</span>
                    <button onClick={() => setQty(l.p.id, l.q + 1)} disabled={l.p.track_inventory === true && l.q >= Number(l.p.stock_quantity ?? 0)} className="h-6 w-6 rounded-md bg-gray-100 text-gray-700 disabled:opacity-40">+</button>
                    <span className="w-16 text-right text-sm font-semibold text-gray-900">{money(l.p.price_cents * l.q)}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
              <span className="text-sm text-gray-500">Total ({itemCount})</span>
              <span className="text-lg font-bold text-gray-900">{money(totalCents)}</span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} placeholder="Customer name (optional)" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="Phone (optional)" inputMode="tel" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>

            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-gray-500">Payment</p>
              <div className="grid grid-cols-3 gap-2">
                {(['cash', 'transfer', 'card'] as PayMethod[]).map((m) => (
                  <button key={m} type="button" onClick={() => setMethod(m)} className={`rounded-lg px-2 py-2 text-sm font-medium capitalize transition ${method === m ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{m}</button>
                ))}
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <button
              type="button"
              onClick={complete}
              disabled={submitting || lines.length === 0}
              className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {submitting ? 'Processing…' : method === 'card' ? `Charge card · ${money(totalCents)}` : `Complete sale · ${money(totalCents)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
