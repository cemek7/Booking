'use client';

import { useMemo, useState } from 'react';
import type { PublicProduct } from '@/lib/publicStorefrontService';

interface StorefrontContainerProps {
  slug: string;
  tenant: { name: string; description: string | null; logo: string | null };
  products: PublicProduct[];
  currency: string;
}

export default function StorefrontContainer({ slug, tenant, products, currency }: StorefrontContainerProps) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ orderId: string; totalCents: number; paymentUrl: string | null } | null>(null);

  const money = useMemo(() => {
    const fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'NGN' });
    return (cents: number) => {
      try { return fmt.format(cents / 100); } catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
    };
  }, [currency]);

  const cartLines = useMemo(
    () =>
      products
        .map((p) => ({ product: p, quantity: qty[p.id] ?? 0 }))
        .filter((l) => l.quantity > 0),
    [products, qty]
  );
  const totalCents = cartLines.reduce((sum, l) => sum + l.product.price_cents * l.quantity, 0);
  const itemCount = cartLines.reduce((sum, l) => sum + l.quantity, 0);

  function setItemQty(id: string, next: number) {
    setError(null);
    setQty((prev) => {
      const copy = { ...prev };
      if (next <= 0) delete copy[id];
      else copy[id] = Math.min(next, 99);
      return copy;
    });
  }

  async function placeOrder() {
    if (cartLines.length === 0) { setError('Your cart is empty.'); return; }
    if (!form.name.trim() || !form.phone.trim()) { setError('Please enter your name and phone number.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/${slug}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cartLines.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
          customer_name: form.name.trim(),
          customer_phone: form.phone.trim(),
          customer_email: form.email.trim() || undefined,
          notes: form.notes.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((json as { message?: string; error?: string })?.message || (json as { error?: string })?.error || 'Could not place your order. Please try again.');
        return;
      }
      setDone({ orderId: json.orderId, totalCents: json.totalCents ?? totalCents, paymentUrl: json.paymentUrl ?? null });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">✓</div>
        <h1 className="mt-4 text-xl font-semibold text-slate-900">Order placed</h1>
        <p className="mt-1 text-sm text-slate-600">
          Thanks{form.name ? `, ${form.name.split(' ')[0]}` : ''}! {tenant.name} has received your order for{' '}
          <span className="font-medium">{money(done.totalCents)}</span>.
        </p>
        {done.paymentUrl ? (
          <a
            href={done.paymentUrl}
            className="mt-5 inline-block rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700"
          >
            Pay now
          </a>
        ) : (
          <p className="mt-4 text-sm text-slate-500">The business will contact you to confirm payment and delivery.</p>
        )}
        <p className="mt-4 text-xs text-slate-400">Reference: {done.orderId}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="text-center">
        {tenant.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tenant.logo} alt={tenant.name} className="mx-auto mb-3 h-16 w-16 rounded-full object-cover" />
        )}
        <h1 className="text-2xl font-bold text-slate-900">{tenant.name}</h1>
        {tenant.description && <p className="mx-auto mt-1 max-w-prose text-sm text-slate-600">{tenant.description}</p>}
      </header>

      {products.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          No products are available right now. Please check back soon.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {products.map((p) => {
            const q = qty[p.id] ?? 0;
            const soldOut = !p.in_stock;
            return (
              <div key={p.id} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                {p.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image} alt={p.name} className="h-20 w-20 flex-shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-300">◻</div>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">{p.name}</span>
                    <span className="whitespace-nowrap text-sm font-semibold text-slate-900">{money(p.price_cents)}</span>
                  </div>
                  {p.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{p.description}</p>}
                  <div className="mt-auto pt-2">
                    {soldOut ? (
                      <span className="text-xs font-medium text-red-500">Out of stock</span>
                    ) : q === 0 ? (
                      <button
                        type="button"
                        onClick={() => setItemQty(p.id, 1)}
                        className="rounded-lg border border-emerald-600 px-3 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50"
                      >
                        Add to cart
                      </button>
                    ) : (
                      <div className="inline-flex items-center gap-2">
                        <button type="button" aria-label="Decrease" onClick={() => setItemQty(p.id, q - 1)} className="h-7 w-7 rounded-md border border-slate-300 text-slate-700">−</button>
                        <span className="min-w-6 text-center text-sm font-medium">{q}</span>
                        <button type="button" aria-label="Increase" onClick={() => setItemQty(p.id, q + 1)} disabled={p.stock_quantity != null && q >= p.stock_quantity} className="h-7 w-7 rounded-md border border-slate-300 text-slate-700 disabled:opacity-40">+</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {cartLines.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Your order</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {cartLines.map((l) => (
              <li key={l.product.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-700">{l.quantity} × {l.product.name}</span>
                <span className="font-medium text-slate-900">{money(l.product.price_cents * l.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-semibold text-slate-900">
            <span>Total ({itemCount} item{itemCount === 1 ? '' : 's'})</span>
            <span>{money(totalCents)}</span>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name *" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone (WhatsApp) *" inputMode="tel" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email (optional)" inputMode="email" className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Delivery address or notes (optional)" rows={2} maxLength={500} className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          </div>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          <button
            type="button"
            onClick={placeOrder}
            disabled={submitting}
            className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {submitting ? 'Placing order…' : `Place order · ${money(totalCents)}`}
          </button>
        </div>
      )}
    </div>
  );
}
