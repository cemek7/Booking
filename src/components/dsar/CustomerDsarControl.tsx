'use client';

import React, { useState } from 'react';
import { authGet, authPost } from '@/lib/auth/auth-api-client';

interface EraseAction {
  table: string;
  op: string;
}

/** Trigger a browser download of a JSON payload (no-op outside the browser). */
function downloadJson(data: unknown, filename: string): void {
  if (typeof window === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Self-contained DSAR control for tenant owners/managers: export or erase one
 * customer's data via /api/tenants/[tenantId]/customers/[customerId]/dsar.
 * Erase is two-step: review the dry-run plan, then confirm.
 *
 * Designed to be dropped into the settings/customer surface with a one-line
 * mount; it owns its own state so it can land independently of that page.
 */
export default function CustomerDsarControl({ tenantId }: { tenantId: string }) {
  const [customerId, setCustomerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [plan, setPlan] = useState<EraseAction[] | null>(null);

  const endpoint = () => `/api/tenants/${tenantId}/customers/${customerId}/dsar`;
  const ready = customerId.trim().length > 0 && !busy;

  const onExport = async () => {
    if (!ready) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await authGet<{ export: unknown }>(endpoint());
      if (res.status === 200) {
        // Download just the export payload, not the { success, export } envelope.
        downloadJson(res.data?.export ?? res.data, `dsar-export-${customerId}.json`);
        setMessage('Export downloaded.');
      } else {
        setMessage('Export failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const onPlanErase = async () => {
    if (!ready) return;
    setBusy(true);
    setMessage(null);
    setPlan(null);
    try {
      const res = await authPost<{ report: { actions: EraseAction[] } }>(endpoint(), {});
      setPlan(res.data?.report?.actions ?? []);
      setMessage('Review the erasure plan below, then confirm.');
    } finally {
      setBusy(false);
    }
  };

  const onConfirmErase = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const res = await authPost(endpoint(), { confirm: true });
      setMessage(res.status === 200 ? 'Customer data erased.' : 'Erase failed.');
      setPlan(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-[#e7e3d7] bg-white p-4">
      <h3 className="text-sm font-semibold text-[#10211a]">Data requests (DSAR)</h3>
      <p className="mt-1 text-xs text-[#3a4a43]">
        Export or erase a customer&apos;s personal data on request. Erasure anonymizes financial
        records and deletes the rest.
      </p>

      <label className="mt-3 block text-xs font-medium text-[#3a4a43]" htmlFor="dsar-customer-id">
        Customer ID
      </label>
      <input
        id="dsar-customer-id"
        value={customerId}
        onChange={(e) => setCustomerId(e.target.value)}
        placeholder="customer uuid"
        className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onExport} disabled={!ready} className="rounded border px-3 py-1.5 text-sm disabled:opacity-50">
          Export data
        </button>
        <button type="button" onClick={onPlanErase} disabled={!ready} className="rounded border px-3 py-1.5 text-sm disabled:opacity-50">
          Plan erasure
        </button>
      </div>

      {plan && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-medium text-red-900">Erasure plan ({plan.length} tables):</p>
          <ul className="mt-1 text-xs text-red-800">
            {plan.map((a) => (
              <li key={a.table}>
                {a.table}: {a.op}
              </li>
            ))}
          </ul>
          <button type="button" onClick={onConfirmErase} disabled={!ready} className="mt-2 rounded bg-red-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            Confirm erasure
          </button>
        </div>
      )}

      {message && <p className="mt-3 text-xs text-[#3a4a43]">{message}</p>}
    </section>
  );
}
