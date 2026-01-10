"use client";
import ReservationsCalendar from '@/components/ReservationsCalendar';
import ReservationsList from '@/components/reservations/ReservationsList';
import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type SupabaseLite from '@/types/supabase';

import Sidebar from '@/components/ui/sidebar';
import RoleGuard from '@/components/RoleGuard';

export default function AdminDashboardPage() {
  // use shared supabase client imported above
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenants, setTenants] = useState<Array<{ id: string; name?: string }>>([]);
  const [authReady, setAuthReady] = useState(false);

  // Wait for auth token to be available before loading data
  useEffect(() => {
    let mounted = true;
    let attempts = 0;
    const maxAttempts = 20; // 20 * 100ms = 2 seconds max

    const checkAuthToken = () => {
      try {
        const token = localStorage.getItem('boka_auth_access_token');
        if (token) {
          console.log('[AdminDashboardPage] ✓ Auth token found, loading admin data');
          if (mounted) setAuthReady(true);
          return;
        }

        attempts++;
        if (attempts < maxAttempts) {
          console.debug(`[AdminDashboardPage] Auth token not yet available (attempt ${attempts}/${maxAttempts}), retrying...`);
          setTimeout(checkAuthToken, 100);
        } else {
          console.warn('[AdminDashboardPage] ✗ Auth token not found after 2 seconds, proceeding anyway');
          if (mounted) setAuthReady(true);
        }
      } catch (err) {
        console.error('[AdminDashboardPage] Error checking auth token:', err);
        if (mounted) setAuthReady(true);
      }
    };

    checkAuthToken();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!authReady) return; // Don't load until auth is ready

    let mounted = true;
      const supabase = getSupabaseBrowserClient();
    async function load() {
      const q = supabase.from<{ id: string; name?: string }>('tenants').select('id,name');
      const res = await import('@/lib/supabaseHelpers').then((m) => m.execWithLimit<{ id: string; name?: string }>(q, 50));
      const tdata: Array<{ id: string; name?: string }>|null = res?.data ?? null;
      if (!mounted) return;
      const typed = (tdata as Array<{ id: string; name?: string }> | null) || [];
      setTenants(typed);
      if (typed.length > 0) setTenantId(typed[0].id);
    }
    load();
    return () => { mounted = false; };
  }, [authReady]);

  if (!authReady) {
    return (
      <RoleGuard requireAdmin>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading admin dashboard...</p>
          </div>
        </div>
      </RoleGuard>
    );
  }

  return (
    <RoleGuard requireAdmin>
      <div className="flex gap-6">
        <Sidebar />
        <div className="flex-1 p-6">
          <h1 className="text-2xl font-bold mb-4">Admin Dashboard</h1>
        <p className="text-sm text-gray-600 mb-4">Admin view — select tenant to manage.</p>
        <div className="mb-4">
          <label className="text-sm mr-2">Select tenant</label>
          <select value={tenantId || ''} onChange={(e) => setTenantId(e.target.value)} className="border rounded px-2 py-1">
            <option value="">-- select --</option>
            {tenants.map((t) => (<option key={t.id} value={t.id}>{t.name || t.id}</option>))}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2">
            {tenantId ? <ReservationsCalendar tenantId={tenantId} /> : <div className="p-4 border">Select a tenant to view calendar</div>}
          </div>
          <div className="col-span-1">
            {tenantId ? <ReservationsList tenantId={tenantId} /> : <div className="p-4 border">Select a tenant to view reservations</div>}
          </div>
        </div>

        <div className="mt-6 p-4 border rounded bg-white">
          <h2 className="font-semibold">LLM Usage (summary)</h2>
          <AdminLLMUsage tenantId={tenantId} />
        </div>
        </div>
      </div>
    </RoleGuard>
  );
}

function AdminLLMUsage({ tenantId }: { tenantId: string | null }) {
  const [usage, setUsage] = useState<{ requests?: number; cost?: number; total_tokens?: number } | null>(null);
  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!tenantId) return setUsage(null);
      try {
        const { authFetch } = await import('@/lib/auth/auth-api-client');
        const response = await authFetch(`/api/admin/llm-usage?tenant_id=${tenantId}`);
        const json = response.data as any;
        if (!mounted) return;
        // normalize shape: prefer numeric fields, fall back to zeros
        const normalized = {
          requests: typeof json?.requests === 'number' ? json.requests : 0,
          cost: typeof json?.cost === 'number' ? json.cost : (typeof json?.estimated_cost === 'number' ? json.estimated_cost : 0),
          total_tokens: typeof json?.total_tokens === 'number' ? json.total_tokens : 0,
        };
        setUsage(normalized);
      } catch (err) {
        console.error('failed to load llm usage', err);
      }
    }
    load();
    return () => { mounted = false; };
  }, [tenantId]);

  if (!tenantId) return null;
  if (!usage) return <div className="text-sm text-gray-500">Loading usage...</div>;
  const reqs = usage.requests ?? 0;
  const cost = usage.cost ?? 0;
  return (
    <div className="mt-2">
      <div className="text-sm">Requests: {reqs}</div>
      <div className="text-sm">Estimated cost: ${cost.toFixed(2)}</div>
    </div>
  );
}

