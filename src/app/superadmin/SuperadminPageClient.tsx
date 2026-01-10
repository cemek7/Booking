'use client';
import React, { useState } from 'react';
import { useSuperadminTenants, useTenantAction } from '@/hooks';
import SuperAdminDashboard from '@/components/SuperAdminDashboard';

interface SuperadminPageClientProps {
  user: { id: string; email: string; role: string };
}

export default function SuperadminPageClient({ user }: SuperadminPageClientProps) {
  const [currentTab, setCurrentTab] = useState<'dashboard' | 'tenants'>('dashboard');
  const [status, setStatus] = useState<string>('');
  const [page, setPage] = useState(1);
  const limit = 10;
  const { data, isLoading, error, refetch } = useSuperadminTenants({ status: status || undefined, page, limit });
  const action = useTenantAction();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation Tabs */}
      <div className="bg-white border-b">
        <div className="px-6 py-4">
          <div className="flex space-x-8">
            <button
              onClick={() => setCurrentTab('dashboard')}
              className={`pb-2 px-1 border-b-2 font-medium text-sm ${
                currentTab === 'dashboard'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setCurrentTab('tenants')}
              className={`pb-2 px-1 border-b-2 font-medium text-sm ${
                currentTab === 'tenants'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Tenants
            </button>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      {currentTab === 'dashboard' && <SuperAdminDashboard />}
      
      {currentTab === 'tenants' && (
        <div className="p-6">
          <h1 className="text-2xl font-semibold">Super-Admin — Tenants</h1>
          <div className="mt-3 flex gap-2 items-center">
            <input placeholder="Filter status (active/suspended)" value={status} onChange={e=>setStatus(e.target.value)} className="border rounded px-2 py-1" />
            <button onClick={()=>{ setPage(1); refetch(); }} className="px-3 py-1 rounded bg-gray-800 text-white">Apply</button>
          </div>
          {isLoading && <div className="mt-4 text-gray-500">Loading…</div>}
          {error && <div className="mt-4 text-red-600">Failed to load tenants.</div>}
          <div className="mt-4">
            <table className="w-full text-sm border bg-white">
              <thead><tr className="bg-gray-50"><th className="p-2 border">Name</th><th className="p-2 border">Status</th><th className="p-2 border">Plan</th><th className="p-2 border">Created</th><th className="p-2 border">Actions</th></tr></thead>
              <tbody>
                {data?.tenants?.map(t => (
                  <tr key={t.id}>
                    <td className="p-2 border">{t.name}</td>
                    <td className="p-2 border">{t.status}</td>
                    <td className="p-2 border">{t.plan || '-'}</td>
                    <td className="p-2 border">{new Date(t.createdAt).toLocaleString()}</td>
                    <td className="p-2 border text-xs">
                      <button className="px-2 py-1 bg-yellow-600 text-white rounded mr-2" onClick={()=> action.mutate({ id: t.id, patch: { status: 'suspended' } })} disabled={action.isPending}>Suspend</button>
                      <button className="px-2 py-1 bg-green-600 text-white rounded" onClick={()=> action.mutate({ id: t.id, patch: { plan: 'pro' } })} disabled={action.isPending}>Upgrade</button>
                    </td>
                  </tr>
                ))}
                {!isLoading && (!data?.tenants || data.tenants.length === 0) && (
                  <tr><td className="p-2 text-center text-gray-500" colSpan={5}>No tenants found.</td></tr>
                )}
              </tbody>
            </table>
            <div className="mt-3 flex items-center gap-2">
              <button className="px-2 py-1 border rounded" onClick={()=> setPage(p => Math.max(1, p-1))} disabled={page===1}>Prev</button>
              <span className="text-xs">Page {page}</span>
              <button className="px-2 py-1 border rounded" onClick={()=> setPage(p => p+1)} disabled={(data?.tenants?.length || 0) < limit}>Next</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}