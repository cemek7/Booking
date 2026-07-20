'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth/auth-api-client';
import { useAuthHeaders } from '@/hooks/useAuthHeaders';

type ApprovalRequest = {
  id: string;
  request_type: 'discount' | 'refund' | 'stock_adjustment';
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  amount?: number | null;
  percent?: number | null;
  reason?: string | null;
  required_permission: string;
  created_at?: string | null;
};

type ApprovalPolicy = {
  request_type: 'discount' | 'refund' | 'stock_adjustment';
  role: 'staff' | 'manager';
  max_self_approve: number;
  requires_permission: string;
};

export default function OwnerApprovalsClient() {
  const headers = useAuthHeaders();
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [policies, setPolicies] = useState<ApprovalPolicy[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!headers) return;

    authFetch<{ requests: ApprovalRequest[]; policies: ApprovalPolicy[] }>('/api/owner/approvals?status=pending', { headers })
      .then((res) => {
        if (!active) return;
        if (res.error) {
          setError(res.error.message);
          return;
        }
        setRequests(res.data?.requests ?? []);
        setPolicies(res.data?.policies ?? []);
        setError(null);
      })
      .catch(() => {
        if (!active) return;
        setError('Failed to load approvals');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [headers]);

  async function decide(requestId: string, decision: 'approve' | 'reject') {
    if (!headers) return;
    const note = decision === 'reject' ? 'Rejected from dashboard' : 'Approved from dashboard';
    const res = await authFetch<{ approval: ApprovalRequest }>(`/api/owner/approvals/${requestId}`, {
      method: 'PATCH',
      headers,
      body: { decision, note },
    });
    if (res.error) {
      setError(res.error.message);
      return;
    }
    setRequests((current) => current.filter((request) => request.id !== requestId));
  }

  async function savePolicy(policy: ApprovalPolicy) {
    if (!headers) return;
    const res = await authFetch<{ policies: ApprovalPolicy[] }>('/api/owner/approvals', {
      method: 'POST',
      headers,
      body: policy,
    });
    if (res.error) {
      setError(res.error.message);
      return;
    }
    const next = res.data?.policies?.[0];
    if (!next) return;
    setPolicies((current) => {
      const filtered = current.filter((row) => !(row.request_type === next.request_type && row.role === next.role));
      return [...filtered, next].sort((a, b) => `${a.request_type}:${a.role}`.localeCompare(`${b.request_type}:${b.role}`));
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Controls</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">Approvals queue</h1>
        <p className="mt-1 text-sm text-slate-600">
          Review discounts, refunds, and stock adjustments that exceeded self-approval limits.
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">Pending requests</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td className="px-4 py-5 text-slate-500" colSpan={4}>Loading approvals…</td></tr>
              ) : requests.length === 0 ? (
                <tr><td className="px-4 py-5 text-slate-500" colSpan={4}>No pending approvals.</td></tr>
              ) : requests.map((request) => (
                <tr key={request.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{request.request_type.replaceAll('_', ' ')}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {request.percent != null ? `${Math.round(Number(request.percent))}%` : request.amount != null ? `₦${Math.round(Number(request.amount) / 100).toLocaleString()}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{request.reason ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button type="button" onClick={() => decide(request.id, 'approve')} className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">Approve</button>
                      <button type="button" onClick={() => decide(request.id, 'reject')} className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">Reject</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Approval policies</h2>
          <p className="mt-1 text-sm text-slate-500">Set how much staff and managers can approve for themselves.</p>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {policies.map((policy) => (
            <div key={`${policy.request_type}:${policy.role}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-900">
                {policy.role} · {policy.request_type.replaceAll('_', ' ')}
              </div>
              <div className="mt-2 text-sm text-slate-600">
                Self-approve up to {policy.request_type === 'discount' ? `${policy.max_self_approve}%` : `₦${Math.round(policy.max_self_approve / 100).toLocaleString()}`}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => savePolicy({ ...policy, max_self_approve: Number(policy.max_self_approve) })}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                >
                  Re-save
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
