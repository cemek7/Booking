'use client';

import { useEffect, useState } from 'react';
import { authGet, authPatch, authPost } from '@/lib/auth/auth-api-client';

type PromoCode = {
  id: string;
  campaign: string;
  amount_credits: number | string;
  starts_at: string | null;
  expires_at: string | null;
  max_redemptions: number | null;
  max_redemptions_per_tenant: number;
  active: boolean;
  created_at: string;
  redemptions: number;
};

/** Fetch only — no state — so it can be shared by the mount effect and handlers. */
async function fetchPromoCodes(): Promise<{ rows: PromoCode[]; error: string | null }> {
  const res = await authGet<{ data?: PromoCode[] }>('/api/superadmin/promo-codes');
  if (res.error) return { rows: [], error: res.error.message };
  return { rows: (res.data as { data?: PromoCode[] } | null)?.data ?? [], error: null };
}

/** Blank stays blank: an empty datetime-local must send null, not ''. */
function toIsoOrNull(localValue: string): string | null {
  if (!localValue) return null;
  const parsed = new Date(localValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function formatWindow(row: PromoCode): string {
  const from = row.starts_at ? new Date(row.starts_at).toLocaleDateString() : null;
  const until = row.expires_at ? new Date(row.expires_at).toLocaleDateString() : null;
  if (from && until) return `${from} – ${until}`;
  if (until) return `Until ${until}`;
  if (from) return `From ${from}`;
  return 'No date limit';
}

function isExpired(row: PromoCode): boolean {
  return Boolean(row.expires_at && new Date(row.expires_at) <= new Date());
}

export default function PromoCodesClient() {
  const [rows, setRows] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [campaign, setCampaign] = useState('');
  const [amount, setAmount] = useState('');
  const [code, setCode] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [perTenant, setPerTenant] = useState('1');

  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Held in state because it is unrecoverable — see the banner below.
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // The initial fetch lives inside the effect, with an `active` guard, which
  // is the pattern the other superadmin clients use: setState reachable
  // synchronously from an effect body trips the cascading-render lint rule.
  useEffect(() => {
    let active = true;

    async function loadOnMount() {
      const res = await fetchPromoCodes();
      if (!active) return;
      setLoading(false);
      if (res.error) { setLoadError(res.error); return; }
      setLoadError(null);
      setRows(res.rows);
    }

    void loadOnMount();
    return () => { active = false; };
  }, []);

  /** Reload after a mutation. Only ever called from an event handler. */
  async function refresh() {
    const res = await fetchPromoCodes();
    if (res.error) { setLoadError(res.error); return; }
    setLoadError(null);
    setRows(res.rows);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setIssuedCode(null);
    setCopied(false);

    const credits = Number(amount);
    if (!campaign.trim()) { setFormError('Name the campaign.'); return; }
    if (!Number.isFinite(credits) || credits <= 0) { setFormError('Enter a credit amount above zero.'); return; }

    setCreating(true);
    const res = await authPost<{ code?: string }>('/api/superadmin/promo-codes', {
      campaign: campaign.trim(),
      amount_credits: credits,
      code: code.trim() ? code.trim() : null,
      starts_at: toIsoOrNull(startsAt),
      expires_at: toIsoOrNull(expiresAt),
      max_redemptions: maxRedemptions.trim() ? Number(maxRedemptions) : null,
      max_redemptions_per_tenant: Number(perTenant) || 1,
    });
    setCreating(false);

    if (res.error) { setFormError(res.error.message); return; }

    setIssuedCode((res.data as { code?: string } | null)?.code ?? null);
    setCampaign(''); setAmount(''); setCode('');
    setStartsAt(''); setExpiresAt(''); setMaxRedemptions(''); setPerTenant('1');
    await refresh();
  }

  async function toggleActive(row: PromoCode) {
    const res = await authPatch(`/api/superadmin/promo-codes/${row.id}`, { active: !row.active });
    if (res.error) { setLoadError(res.error.message); return; }
    await refresh();
  }

  async function copyIssued() {
    if (!issuedCode) return;
    try {
      await navigator.clipboard.writeText(issuedCode);
      setCopied(true);
    } catch {
      // Clipboard is blocked in some browsers/contexts; the code is on screen
      // to be copied by hand, so this is not worth an error state.
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Promo codes</h1>
        <p className="mt-1 text-sm text-slate-600">
          Promotional credit is the one way value enters a wallet without a payment. Codes are
          superadmin-only, capped per tenant, and every redemption is recorded against the campaign.
        </p>
      </div>

      {issuedCode && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold text-amber-900">Copy this code now</h2>
          <p className="mt-1 text-sm text-amber-800">
            Only a hash is stored, so this is the one and only time it can be shown. If you lose it,
            deactivate the code and create another.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-lg tracking-widest text-slate-900">
              {issuedCode}
            </code>
            <button
              type="button"
              onClick={copyIssued}
              className="rounded-xl border border-amber-400 px-3 py-2 text-sm font-medium text-amber-900 transition hover:bg-amber-100"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => setIssuedCode(null)}
              className="text-sm text-amber-800 underline"
            >
              I have saved it
            </button>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">New code</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className="block text-sm font-medium text-slate-700">Campaign</span>
            <input
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
              placeholder="September launch"
              className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
            <span className="mt-1 block text-xs text-slate-500">Shown on the tenant&rsquo;s wallet ledger.</span>
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-slate-700">Credits granted</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="500"
              className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
            <span className="mt-1 block text-xs text-slate-500">1 credit = &#8358;1.</span>
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-slate-700">Code</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Leave blank to generate"
              className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm uppercase focus:border-slate-400 focus:outline-none"
            />
            <span className="mt-1 block text-xs text-slate-500">Generated codes avoid 0/O and 1/I/L.</span>
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-slate-700">Starts (optional)</span>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-slate-700">Expires (optional)</span>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-sm font-medium text-slate-700">Total uses</span>
              <input
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value)}
                inputMode="numeric"
                placeholder="Unlimited"
                className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-slate-700">Per tenant</span>
              <input
                value={perTenant}
                onChange={(e) => setPerTenant(e.target.value)}
                inputMode="numeric"
                className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </label>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={creating}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            {creating ? 'Creating…' : 'Create code'}
          </button>
          {formError && <span className="text-sm text-red-600">{formError}</span>}
        </div>
      </form>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Existing codes</h2>
        </div>

        {loading ? (
          <p className="px-5 py-6 text-sm text-slate-500">Loading…</p>
        ) : loadError ? (
          <p className="px-5 py-6 text-sm text-red-600">{loadError}</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No promo codes yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3">Campaign</th>
                  <th scope="col" className="px-5 py-3">Credits</th>
                  <th scope="col" className="px-5 py-3">Used</th>
                  <th scope="col" className="px-5 py-3">Per tenant</th>
                  <th scope="col" className="px-5 py-3">Window</th>
                  <th scope="col" className="px-5 py-3">Status</th>
                  <th scope="col" className="px-5 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const exhausted = row.max_redemptions !== null && row.redemptions >= row.max_redemptions;
                  return (
                    <tr key={row.id}>
                      <td className="px-5 py-3 font-medium text-slate-900">{row.campaign}</td>
                      <td className="px-5 py-3 text-slate-700">{Number(row.amount_credits).toLocaleString()}</td>
                      <td className="px-5 py-3 text-slate-700">
                        {row.redemptions}{row.max_redemptions !== null ? ` / ${row.max_redemptions}` : ''}
                      </td>
                      <td className="px-5 py-3 text-slate-700">{row.max_redemptions_per_tenant}</td>
                      <td className="px-5 py-3 text-slate-700">{formatWindow(row)}</td>
                      <td className="px-5 py-3">
                        {!row.active ? (
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">Inactive</span>
                        ) : isExpired(row) ? (
                          <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">Expired</span>
                        ) : exhausted ? (
                          <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">Fully used</span>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-800">Active</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => toggleActive(row)}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          {row.active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
          Codes cannot be shown again or deleted — a redeemed code is an accounting record.
          Deactivate to retire a campaign.
        </p>
      </div>
    </div>
  );
}
