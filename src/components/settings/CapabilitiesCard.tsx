'use client';

import { useEffect, useState } from 'react';
import { authGet, authPatch } from '@/lib/auth/auth-api-client';
import {
  ALL_CAPABILITIES,
  CAPABILITY_LABELS,
  CAPABILITY_DESCRIPTIONS,
  DEFAULT_CAPABILITIES,
  resolveCapabilities,
  type Capability,
  type TenantCapabilities,
} from '@/lib/capabilities';

/**
 * Owner-only card to choose which Booka workflows this business runs. Turning a
 * capability off hides its dashboard surfaces (e.g. a sales-only shop hides
 * Bookings/Schedule/Services). All-on by default; changes take effect on the
 * next page load (the nav is seeded server-side).
 */
export default function CapabilitiesCard({ tenantId }: { tenantId: string }) {
  const [caps, setCaps] = useState<TenantCapabilities>(DEFAULT_CAPABILITIES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await authGet<{ capabilities?: unknown }>(`/api/tenants/${tenantId}/settings`);
      if (!active) return;
      setCaps(resolveCapabilities(res.data?.capabilities));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [tenantId]);

  function toggle(cap: Capability) {
    setStatus(null);
    setCaps((prev) => {
      const next = { ...prev, [cap]: !prev[cap] };
      // Inventory depends on Sales — turning Sales off also disables Inventory.
      if (cap === 'sales' && !next.sales) next.inventory = false;
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    const res = await authPatch(`/api/tenants/${tenantId}/settings`, { capabilities: caps });
    setSaving(false);
    if (res.error) {
      setStatus({ kind: 'err', msg: 'Could not save. Please try again.' });
    } else {
      setStatus({ kind: 'ok', msg: 'Saved. Reload to see your updated menu.' });
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Workflows</h2>
      <p className="mt-1 text-sm text-gray-600">
        Choose what your business does on Booka. Turn off what you don&apos;t use and it disappears
        from your menu — you can turn it back on any time.
      </p>

      <div className="mt-4 divide-y divide-gray-100">
        {ALL_CAPABILITIES.map((cap) => {
          const disabled = cap === 'inventory' && !caps.sales;
          return (
            <label
              key={cap}
              className={`flex items-start justify-between gap-4 py-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
            >
              <span>
                <span className="block text-sm font-medium text-gray-900">{CAPABILITY_LABELS[cap]}</span>
                <span className="block text-xs text-gray-500">{CAPABILITY_DESCRIPTIONS[cap]}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={caps[cap]}
                aria-label={CAPABILITY_LABELS[cap]}
                disabled={disabled || loading}
                onClick={() => toggle(cap)}
                className={`relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                  caps[cap] ? 'bg-emerald-600' : 'bg-gray-300'
                } ${disabled || loading ? 'cursor-not-allowed' : ''}`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${
                    caps[cap] ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || loading}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save workflows'}
        </button>
        {status && (
          <span className={`text-sm ${status.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>
            {status.msg}
          </span>
        )}
      </div>
    </section>
  );
}
