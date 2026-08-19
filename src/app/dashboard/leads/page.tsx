"use client";

export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Mail, Phone, UserPlus, X } from 'lucide-react';
import { useTenant } from '@/lib/supabase/tenant-context';
import { toast } from '@/components/ui/toast';
import { authFetch, authPatch } from '@/lib/auth/auth-api-client';

interface Lead {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  source: string;
  intent: string | null;
  notes: string | null;
  status: 'new' | 'contacted' | 'converted' | 'dismissed';
  follow_up_at: string | null;
  followed_up_at: string | null;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  converted: 'Converted',
  dismissed: 'Dismissed',
};

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-amber-100 text-amber-700',
  converted: 'bg-emerald-100 text-emerald-700',
  dismissed: 'bg-slate-100 text-slate-500',
};

async function fetchLeads(status?: string): Promise<{ data: Lead[]; total: number }> {
  const params = new URLSearchParams();
  if (status && status !== 'all') params.set('status', status);
  params.set('limit', '100');
  const res = await authFetch<{ data: Lead[]; total: number }>(`/api/leads?${params.toString()}`);
  if (res.error || !res.data) return { data: [], total: 0 };
  return res.data;
}

async function patchLead(payload: { id: string; status?: Lead['status']; follow_up_at?: string; notes?: string }) {
  const res = await authPatch('/api/leads', payload);
  if (res.error) throw new Error(res.error.message || 'Failed to update lead');
  return res.data;
}

const TABS = ['all', 'new', 'contacted', 'converted', 'dismissed'] as const;

export default function LeadsPage() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? '';
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['leads', tenantId, statusFilter],
    queryFn: () => fetchLeads(statusFilter),
    enabled: !!tenantId,
  });

  // Unfiltered pull for the summary counts, so the pills always reflect totals.
  const { data: allData } = useQuery({
    queryKey: ['leads', tenantId, 'all-summary'],
    queryFn: () => fetchLeads('all'),
    enabled: !!tenantId,
  });

  const mutation = useMutation({
    mutationFn: patchLead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads', tenantId] });
      toast.success('Lead updated');
    },
    onError: () => toast.error('Failed to update lead'),
  });

  const leads = data?.data ?? [];

  const counts = useMemo(() => {
    const c: Record<string, number> = { new: 0, contacted: 0, converted: 0, dismissed: 0 };
    for (const l of allData?.data ?? []) c[l.status] = (c[l.status] || 0) + 1;
    return c;
  }, [allData]);

  const total = allData?.total ?? 0;
  const conversionRate = total > 0 ? Math.round((counts.converted / total) * 100) : 0;

  function formatDate(iso: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Leads</h1>
        <p className="mt-1 text-sm text-slate-500">
          Prospects your AI front desk captured from WhatsApp and Instagram conversations — follow up and turn them into customers.
        </p>
      </div>

      {/* Summary strip */}
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: 'New', value: counts.new, tone: 'text-blue-700' },
          { label: 'Contacted', value: counts.contacted, tone: 'text-amber-700' },
          { label: 'Converted', value: counts.converted, tone: 'text-emerald-700' },
          { label: 'Conversion rate', value: `${conversionRate}%`, tone: 'text-slate-900' },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">{s.label}</p>
            <p className={`mt-2 text-2xl font-semibold tabular-nums ${s.tone}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Filter tabs */}
        <div className="flex flex-wrap gap-2 border-b border-slate-200 px-6 py-4">
          {TABS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                statusFilter === s
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {s === 'all' ? `All (${total})` : `${STATUS_LABELS[s]} (${counts[s] ?? 0})`}
            </button>
          ))}
        </div>

        {isLoading && <div className="px-6 py-10 text-sm text-slate-500">Loading leads…</div>}

        {!isLoading && leads.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <UserPlus className="h-6 w-6" />
            </span>
            <p className="text-sm font-medium text-slate-700">No leads here yet</p>
            <p className="max-w-md text-sm text-slate-500">
              Leads are captured automatically from incomplete WhatsApp and Instagram conversations when lead capture is enabled in your agent settings.
            </p>
          </div>
        )}

        {!isLoading && leads.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-6 py-3">Contact</th>
                  <th className="px-6 py-3">Intent</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Captured</th>
                  <th className="px-6 py-3">Follow-up</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-6 py-3">
                      <div className="font-medium text-slate-900">{lead.name ?? lead.phone}</div>
                      <div className="mt-0.5 flex flex-col gap-0.5 text-xs text-slate-400">
                        {lead.name && (
                          <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{lead.phone}</span>
                        )}
                        {lead.email && (
                          <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{lead.email}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3 capitalize text-slate-600">{lead.intent ?? '—'}</td>
                    <td className="px-6 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[lead.status]}`}>
                        {STATUS_LABELS[lead.status]}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-slate-500">{formatDate(lead.created_at)}</td>
                    <td className="px-6 py-3 text-slate-500">{formatDate(lead.follow_up_at)}</td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end gap-1">
                        {lead.status === 'new' && (
                          <button
                            onClick={() => mutation.mutate({ id: lead.id, status: 'contacted', follow_up_at: new Date().toISOString() })}
                            className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                          >
                            <Clock className="h-3 w-3" /> Follow up
                          </button>
                        )}
                        {lead.status !== 'converted' && (
                          <button
                            onClick={() => mutation.mutate({ id: lead.id, status: 'converted' })}
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                          >
                            <CheckCircle2 className="h-3 w-3" /> Convert
                          </button>
                        )}
                        {lead.status !== 'dismissed' && (
                          <button
                            onClick={() => mutation.mutate({ id: lead.id, status: 'dismissed' })}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
                          >
                            <X className="h-3 w-3" /> Dismiss
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
