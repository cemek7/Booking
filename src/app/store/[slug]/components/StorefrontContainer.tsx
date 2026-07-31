'use client';

import { useMemo, useState } from 'react';
import type { PublicProduct } from '@/lib/publicStorefrontService';

interface StorefrontContainerProps {
  slug: string;
  tenant: { name: string; description: string | null; logo: string | null };
  products: PublicProduct[];
  currency: string;
}

type CheckoutStep = 'cart' | 'details';

export default function StorefrontContainer({ slug, tenant, products, currency }: StorefrontContainerProps) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [cartOpen, setCartOpen] = useState(false);
  const [step, setStep] = useState<CheckoutStep>('cart');
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ orderId: string; totalCents: number } | null>(null);

  const money = useMemo(() => {
    const fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 });
    return (cents: number) => {
      try { return fmt.format(cents / 100); } catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
    };
  }, [currency]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => { if (p.category) set.add(p.category); });
    return Array.from(set).sort();
  }, [products]);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      if (activeCategory !== 'all' && p.category !== activeCategory) return false;
      if (!term) return true;
      return p.name.toLowerCase().includes(term) || (p.description ?? '').toLowerCase().includes(term);
    });
  }, [products, search, activeCategory]);

  const cartLines = useMemo(
    () => products.map((p) => ({ product: p, quantity: qty[p.id] ?? 0 })).filter((l) => l.quantity > 0),
    [products, qty]
  );
  const totalCents = cartLines.reduce((s, l) => s + l.product.price_cents * l.quantity, 0);
  const itemCount = cartLines.reduce((s, l) => s + l.quantity, 0);

  function setItemQty(id: string, next: number) {
    setError(null);
    setQty((prev) => {
      const copy = { ...prev };
      if (next <= 0) delete copy[id];
      else copy[id] = Math.min(next, 99);
      return copy;
    });
  }

  function openCart() { setStep('cart'); setCartOpen(true); }

  async function placeOrder() {
    if (cartLines.length === 0) { setError('Your cart is empty.'); return; }
    if (!form.name.trim() || !form.phone.trim()) { setError('Please enter your name and phone number.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const combinedNotes = [form.address.trim() ? `Deliver to: ${form.address.trim()}` : '', form.notes.trim()]
        .filter(Boolean).join('\n').slice(0, 500);
      const res = await fetch(`/api/public/${slug}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cartLines.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
          customer_name: form.name.trim(),
          customer_phone: form.phone.trim(),
          customer_email: form.email.trim() || undefined,
          notes: combinedNotes || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((json as { message?: string; error?: string })?.message || (json as { error?: string })?.error || 'Could not place your order. Please try again.');
        return;
      }
      // Paystack: redirect straight to secure checkout. Otherwise, inline success.
      if (json.paymentUrl) { window.location.href = json.paymentUrl as string; return; }
      setDone({ orderId: json.orderId, totalCents: json.totalCents ?? totalCents });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const initial = (tenant.name || '?').trim().charAt(0).toUpperCase();

  // ── Order placed (no online payment configured) ──
  if (done) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
        <h1 className="mt-5 text-2xl font-bold text-slate-900">Order placed</h1>
        <p className="mt-2 text-sm text-slate-600">
          Thanks{form.name ? `, ${form.name.split(' ')[0]}` : ''}! {tenant.name} has your order for{' '}
          <span className="font-semibold text-slate-900">{money(done.totalCents)}</span> and will reach out on WhatsApp to confirm payment and delivery.
        </p>
        <p className="mt-6 text-xs text-slate-400">Order reference: {done.orderId}</p>
      </div>
    );
  }

  return (
    <div className="pb-24">
      {/* ── Sticky header ── */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {tenant.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tenant.logo} alt={tenant.name} className="h-9 w-9 flex-shrink-0 rounded-full object-cover" />
            ) : (
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">{initial}</div>
            )}
            <span className="truncate text-base font-semibold text-slate-900">{tenant.name}</span>
          </div>
          <button
            type="button"
            onClick={openCart}
            className="relative inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            <span aria-hidden>🛒</span>
            <span className="hidden sm:inline">Cart</span>
            {itemCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[11px] font-bold text-white">{itemCount}</span>
            )}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4">
        {/* ── Intro ── */}
        {tenant.description && (
          <p className="mx-auto mt-6 max-w-prose text-center text-sm text-slate-600">{tenant.description}</p>
        )}

        {/* ── Search + categories ── */}
        {products.length > 0 && (
          <div className="mt-6 space-y-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products…"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            {categories.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {['all', ...categories].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setActiveCategory(c)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      activeCategory === c ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {c === 'all' ? 'All' : c}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Product grid ── */}
        {products.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            This shop hasn&apos;t added any products yet. Please check back soon.
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="mt-10 text-center text-sm text-slate-500">No products match your search.</div>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {visibleProducts.map((p) => {
              const q = qty[p.id] ?? 0;
              const soldOut = !p.in_stock;
              return (
                <div key={p.id} className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
                  <div className="relative aspect-square w-full overflow-hidden bg-slate-100">
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt={p.name} className="h-full w-full object-cover transition group-hover:scale-105" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-4xl text-slate-200">🛍️</div>
                    )}
                    {soldOut && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-semibold uppercase tracking-wide text-slate-500">Sold out</div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-3">
                    <h3 className="line-clamp-2 text-sm font-semibold text-slate-900">{p.name}</h3>
                    {p.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{p.description}</p>}
                    <div className="mt-2 flex items-center justify-between gap-2 pt-1">
                      <span className="text-sm font-bold text-slate-900">{money(p.price_cents)}</span>
                      {soldOut ? null : q === 0 ? (
                        <button type="button" onClick={() => setItemQty(p.id, 1)} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-emerald-700">Add</button>
                      ) : (
                        <div className="inline-flex items-center gap-1.5">
                          <button type="button" aria-label="Decrease" onClick={() => setItemQty(p.id, q - 1)} className="h-6 w-6 rounded-md bg-slate-100 text-slate-700">−</button>
                          <span className="min-w-5 text-center text-xs font-semibold">{q}</span>
                          <button type="button" aria-label="Increase" onClick={() => setItemQty(p.id, q + 1)} disabled={p.stock_quantity != null && q >= p.stock_quantity} className="h-6 w-6 rounded-md bg-slate-100 text-slate-700 disabled:opacity-40">+</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Mobile sticky "view cart" bar ── */}
      {itemCount > 0 && !cartOpen && (
        <button
          type="button"
          onClick={openCart}
          className="fixed inset-x-4 bottom-4 z-20 flex items-center justify-between rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg sm:hidden"
        >
          <span>{itemCount} item{itemCount === 1 ? '' : 's'}</span>
          <span>View cart · {money(totalCents)}</span>
        </button>
      )}

      {/* ── Cart / checkout drawer ── */}
      {cartOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="fixed inset-0 bg-black/40" onClick={() => setCartOpen(false)} aria-hidden />
          <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">
                {step === 'cart' ? 'Your cart' : 'Checkout'}
              </h2>
              <button type="button" onClick={() => setCartOpen(false)} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {cartLines.length === 0 ? (
                <p className="mt-10 text-center text-sm text-slate-500">Your cart is empty.</p>
              ) : step === 'cart' ? (
                <ul className="divide-y divide-slate-100">
                  {cartLines.map((l) => (
                    <li key={l.product.id} className="flex gap-3 py-3">
                      <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100">
                        {l.product.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.product.image} alt={l.product.name} className="h-full w-full object-cover" />
                        ) : <div className="flex h-full w-full items-center justify-center text-xl text-slate-300">🛍️</div>}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex items-start justify-between gap-2">
                          <span className="truncate text-sm font-medium text-slate-900">{l.product.name}</span>
                          <span className="whitespace-nowrap text-sm font-semibold text-slate-900">{money(l.product.price_cents * l.quantity)}</span>
                        </div>
                        <div className="mt-auto flex items-center gap-2 pt-1">
                          <button type="button" aria-label="Decrease" onClick={() => setItemQty(l.product.id, l.quantity - 1)} className="h-6 w-6 rounded-md bg-slate-100 text-slate-700">−</button>
                          <span className="min-w-5 text-center text-xs font-semibold">{l.quantity}</span>
                          <button type="button" aria-label="Increase" onClick={() => setItemQty(l.product.id, l.quantity + 1)} disabled={l.product.stock_quantity != null && l.quantity >= l.product.stock_quantity} className="h-6 w-6 rounded-md bg-slate-100 text-slate-700 disabled:opacity-40">+</button>
                          <button type="button" onClick={() => setItemQty(l.product.id, 0)} className="ml-auto text-xs text-red-500 hover:text-red-600">Remove</button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="space-y-3">
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name *" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone (WhatsApp) *" inputMode="tel" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email (for your receipt)" inputMode="email" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Delivery address" rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Order notes (optional)" rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </div>
              )}
            </div>

            {cartLines.length > 0 && (
              <div className="border-t border-slate-200 px-5 py-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Total ({itemCount} item{itemCount === 1 ? '' : 's'})</span>
                  <span className="text-base font-bold text-slate-900">{money(totalCents)}</span>
                </div>
                {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
                {step === 'cart' ? (
                  <button type="button" onClick={() => { setError(null); setStep('details'); }} className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
                    Continue to checkout
                  </button>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => setStep('cart')} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700">Back</button>
                    <button type="button" onClick={placeOrder} disabled={submitting} className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">
                      {submitting ? 'Processing…' : `Pay ${money(totalCents)}`}
                    </button>
                  </div>
                )}
                <p className="mt-2 text-center text-[11px] text-slate-400">Secure checkout · powered by Paystack</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
