"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth/auth-api-client';
import { useTenant } from '@/lib/supabase/tenant-context';

// Currencies Booka tenants actually operate in. NGN first — primary market.
const CURRENCIES = [
  { code: 'NGN', label: '₦ Nigerian Naira' },
  { code: 'USD', label: '$ US Dollar' },
  { code: 'GHS', label: '₵ Ghanaian Cedi' },
  { code: 'KES', label: 'KSh Kenyan Shilling' },
  { code: 'ZAR', label: 'R South African Rand' },
  { code: 'GBP', label: '£ British Pound' },
  { code: 'EUR', label: '€ Euro' },
];

const TIMEZONES = [
  'Africa/Lagos',
  'Africa/Accra',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'Europe/London',
  'America/New_York',
  'UTC',
];

type SettingsState = {
  displayName: string;
  timezone: string;
  contactEmail: string;
  defaultCurrency: string;
  requireDeposit: boolean;
  depositPercent: string;
  bookingBufferMinutes: string;
  maxAdvanceBookingDays: string;
  minAdvanceBookingHours: string;
  autoCancelUnconfirmedEnabled: boolean;
  autoCancelHoursBefore: string;
  cancellationPolicy: string;
  publicBookingEnabled: boolean;
  publicDescription: string;
};

const EMPTY: SettingsState = {
  displayName: '',
  timezone: 'Africa/Lagos',
  contactEmail: '',
  defaultCurrency: 'NGN',
  requireDeposit: false,
  depositPercent: '',
  bookingBufferMinutes: '',
  maxAdvanceBookingDays: '',
  minAdvanceBookingHours: '',
  autoCancelUnconfirmedEnabled: false,
  autoCancelHoursBefore: '2',
  cancellationPolicy: '',
  publicBookingEnabled: false,
  publicDescription: '',
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const inputCls =
  'mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

export default function TenantSettingsClient() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const [state, setState] = useState<SettingsState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const set = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const r = await authFetch<Record<string, unknown>>(`/api/tenants/${tenantId}/settings`);
    if (r.data && !r.error) {
      const d = r.data;
      setState({
        displayName: String(d.displayName ?? ''),
        timezone: String(d.timezone ?? 'Africa/Lagos'),
        contactEmail: String(d.contactEmail ?? ''),
        defaultCurrency: String(d.defaultCurrency ?? 'NGN'),
        requireDeposit: Boolean(d.requireDeposit),
        depositPercent: d.depositPercent != null ? String(d.depositPercent) : '',
        bookingBufferMinutes: d.bookingBufferMinutes != null ? String(d.bookingBufferMinutes) : '',
        maxAdvanceBookingDays: d.maxAdvanceBookingDays != null ? String(d.maxAdvanceBookingDays) : '',
        minAdvanceBookingHours: d.minAdvanceBookingHours != null ? String(d.minAdvanceBookingHours) : '',
        autoCancelUnconfirmedEnabled: Boolean(d.autoCancelUnconfirmedEnabled),
        autoCancelHoursBefore: d.autoCancelHoursBefore != null ? String(d.autoCancelHoursBefore) : '2',
        cancellationPolicy: String(d.cancellationPolicy ?? ''),
        publicBookingEnabled: Boolean(d.publicBookingEnabled),
        publicDescription: String(d.publicDescription ?? ''),
      });
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!tenantId) return;
    setSaving(true);
    setMessage(null);

    const num = (v: string) => (v === '' ? undefined : Number(v));
    const payload: Record<string, unknown> = {
      displayName: state.displayName || undefined,
      timezone: state.timezone || undefined,
      contactEmail: state.contactEmail || undefined,
      defaultCurrency: state.defaultCurrency || undefined,
      requireDeposit: state.requireDeposit,
      depositPercent: num(state.depositPercent),
      bookingBufferMinutes: num(state.bookingBufferMinutes),
      maxAdvanceBookingDays: num(state.maxAdvanceBookingDays),
      minAdvanceBookingHours: num(state.minAdvanceBookingHours),
      autoCancelUnconfirmedEnabled: state.autoCancelUnconfirmedEnabled,
      autoCancelHoursBefore: num(state.autoCancelHoursBefore),
      cancellationPolicy: state.cancellationPolicy || undefined,
      publicBookingEnabled: state.publicBookingEnabled,
      publicDescription: state.publicDescription || undefined,
    };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    const r = await authFetch(`/api/tenants/${tenantId}/settings`, { method: 'PATCH', body: payload });
    setMessage(
      r.error
        ? { kind: 'err', text: r.error.message || 'Could not save settings. Try again.' }
        : { kind: 'ok', text: 'Settings saved.' }
    );
    setSaving(false);
  }

  if (!tenantId || loading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Loading settings…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Business */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">Business</h3>
        <p className="text-sm text-slate-500">How your business shows up to customers.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Business name">
            <input className={inputCls} value={state.displayName} onChange={(e) => set('displayName', e.target.value)} />
          </Field>
          <Field label="Contact email">
            <input type="email" className={inputCls} value={state.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
          </Field>
          <Field label="Timezone">
            <select className={inputCls} value={state.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </Field>
          <Field label="Currency" hint="Prices, orders, and reports use this currency.">
            <select className={inputCls} value={state.defaultCurrency} onChange={(e) => set('defaultCurrency', e.target.value)}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </Field>
        </div>
      </section>

      {/* Bookings */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">Bookings</h3>
        <p className="text-sm text-slate-500">Rules your AI front desk follows when it books for you.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Buffer between bookings (min)">
            <input type="number" min={0} className={inputCls} value={state.bookingBufferMinutes} onChange={(e) => set('bookingBufferMinutes', e.target.value)} />
          </Field>
          <Field label="Book up to (days ahead)">
            <input type="number" min={1} className={inputCls} value={state.maxAdvanceBookingDays} onChange={(e) => set('maxAdvanceBookingDays', e.target.value)} />
          </Field>
          <Field label="Minimum notice (hours)">
            <input type="number" min={0} className={inputCls} value={state.minAdvanceBookingHours} onChange={(e) => set('minAdvanceBookingHours', e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-emerald-600" checked={state.autoCancelUnconfirmedEnabled} onChange={(e) => set('autoCancelUnconfirmedEnabled', e.target.checked)} />
            Auto-cancel unconfirmed bookings
          </label>
          {state.autoCancelUnconfirmedEnabled && (
            <Field label="Hours before appointment">
              <input type="number" min={1} className={inputCls} value={state.autoCancelHoursBefore} onChange={(e) => set('autoCancelHoursBefore', e.target.value)} />
            </Field>
          )}
        </div>
      </section>

      {/* Payments */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">Payments &amp; deposits</h3>
        <p className="text-sm text-slate-500">Protect your time — ask for a deposit when customers book.</p>
        <div className="mt-4 flex flex-wrap items-end gap-6">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-emerald-600" checked={state.requireDeposit} onChange={(e) => set('requireDeposit', e.target.checked)} />
            Require a deposit to confirm a booking
          </label>
          {state.requireDeposit && (
            <Field label="Deposit (% of price)">
              <input type="number" min={0} max={100} className={inputCls} value={state.depositPercent} onChange={(e) => set('depositPercent', e.target.value)} />
            </Field>
          )}
        </div>
        <div className="mt-4">
          <Field label="Cancellation policy" hint="Shown to customers and used by your assistant when someone cancels.">
            <textarea rows={3} className={inputCls} value={state.cancellationPolicy} onChange={(e) => set('cancellationPolicy', e.target.value)} />
          </Field>
        </div>
      </section>

      {/* Storefront */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">Public booking page</h3>
        <p className="text-sm text-slate-500">Let customers book directly from your public page.</p>
        <div className="mt-4 space-y-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-emerald-600" checked={state.publicBookingEnabled} onChange={(e) => set('publicBookingEnabled', e.target.checked)} />
            Enable public booking page
          </label>
          {state.publicBookingEnabled && (
            <Field label="Public description" hint="A short intro customers see on your booking page (max 500 characters).">
              <textarea rows={3} maxLength={500} className={inputCls} value={state.publicDescription} onChange={(e) => set('publicDescription', e.target.value)} />
            </Field>
          )}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          disabled={saving}
          onClick={() => void save()}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {message && (
          <span className={message.kind === 'ok' ? 'text-sm text-emerald-700' : 'text-sm text-red-600'}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
