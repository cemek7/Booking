"use client";

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/lib/supabase/tenant-context';
import { toast } from '@/components/ui/toast';

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
  contacted: 'bg-yellow-100 text-yellow-700',
  converted: 'bg-green-100 text-green-700',
  dismissed: 'bg-gray-100 text-gray-500',
};

async function fetchLeads(tenantId: string, status?: string): Promise<{ data: Lead[]; total: number }> {
  const params = new URLSearchParams();
  if (status && status !== 'all') params.set('status', status);
  params.set('limit', '100');
  const res = await fetch(`/api/leads?${params.toString()}`, {
    headers: { 'X-Tenant-ID': tenantId },
  });
  if (!res.ok) return { data: [], total: 0 };
  return res.json();
}

async function patchLead(payload: { id: string; status?: Lead['status']; follow_up_at?: string; notes?: string }) {
  const res = await fetch('/api/leads', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to update lead');
  return res.json();
}

export default function LeadsPage() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? '';
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['leads', tenantId, statusFilter],
    queryFn: () => fetchLeads(tenantId, statusFilter),
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

  function formatDate(iso: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Leads</h1>
        <span className="text-sm text-gray-500">{data?.total ?? 0} total</span>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {['all', 'new', 'contacted', 'converted', 'dismissed'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded-full text-sm border transition-colors ${
              statusFilter === s
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white hover:bg-gray-50'
            }`}
          >
            {s === 'all' ? 'All' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {isLoading && <div className="text-sm text-gray-500">Loading leads…</div>}

      {!isLoading && leads.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">
          No leads yet. Leads are captured automatically from incomplete WhatsApp conversations
          when lead capture is enabled in Agent Settings.
        </div>
      )}

      {!isLoading && leads.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500 uppercase">
                <th className="pb-2 pr-4">Contact</th>
                <th className="pb-2 pr-4">Intent</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Captured</th>
                <th className="pb-2 pr-4">Follow-up</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-b hover:bg-gray-50">
                  <td className="py-3 pr-4">
                    <div className="font-medium">{lead.name ?? lead.phone}</div>
                    {lead.name && <div className="text-xs text-gray-400">{lead.phone}</div>}
                    {lead.email && <div className="text-xs text-gray-400">{lead.email}</div>}
                  </td>
                  <td className="py-3 pr-4 text-gray-600 capitalize">{lead.intent ?? '—'}</td>
                  <td className="py-3 pr-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[lead.status]}`}>
                      {STATUS_LABELS[lead.status]}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-gray-500">{formatDate(lead.created_at)}</td>
                  <td className="py-3 pr-4 text-gray-500">{formatDate(lead.follow_up_at)}</td>
                  <td className="py-3">
                    <div className="flex gap-1">
                      {lead.status !== 'converted' && (
                        <button
                          onClick={() => mutation.mutate({ id: lead.id, status: 'converted' })}
                          className="px-2 py-1 text-xs rounded bg-green-50 text-green-700 hover:bg-green-100 border border-green-200"
                        >
                          Converted
                        </button>
                      )}
                      {lead.status !== 'dismissed' && (
                        <button
                          onClick={() => mutation.mutate({ id: lead.id, status: 'dismissed' })}
                          className="px-2 py-1 text-xs rounded bg-gray-50 text-gray-500 hover:bg-gray-100 border border-gray-200"
                        >
                          Dismiss
                        </button>
                      )}
                      {lead.status === 'new' && (
                        <button
                          onClick={() =>
                            mutation.mutate({
                              id: lead.id,
                              status: 'contacted',
                              follow_up_at: new Date().toISOString(),
                            })
                          }
                          className="px-2 py-1 text-xs rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200"
                        >
                          Follow up now
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
  );
}
