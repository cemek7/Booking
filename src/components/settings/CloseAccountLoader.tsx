'use client';

import React, { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth/auth-api-client';
import CloseAccountSection from './CloseAccountSection';

type LifecycleState = 'active' | 'scheduled_for_deletion' | 'purging' | 'purged';

/**
 * Self-contained loader for the Close-Account section. Resolves the current
 * tenant (id/name from localStorage, like TenantSettingsClient) and its
 * lifecycle_state from the settings GET, then renders CloseAccountSection.
 * Kept separate so it can mount via the clean TenantSettingsHost without
 * touching the heavily-edited TenantSettingsClient.
 */
export default function CloseAccountLoader() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [lifecycleState, setLifecycleState] = useState<LifecycleState>('active');
  const [scheduledPurgeAt, setScheduledPurgeAt] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = typeof window !== 'undefined' ? localStorage.getItem('current_tenant') : null;
        const current = raw ? JSON.parse(raw) : null;
        const id: string | null = current?.id ?? null;
        if (!id) return;
        setTenantId(id);
        setName(current?.name ?? '');

        const res = await authFetch<{ row?: { lifecycle_state?: string; scheduled_purge_at?: string | null } }>(`/api/admin/tenant/${id}/settings`);
        if (!res.error) {
          const row = res.data?.row ?? null;
          if (row?.lifecycle_state) setLifecycleState(row.lifecycle_state as LifecycleState);
          setScheduledPurgeAt(row?.scheduled_purge_at ?? null);
        }
      } catch {
        // Non-fatal: fall back to an 'active' close form.
      } finally {
        setReady(true);
      }
    })();
  }, []);

  if (!ready || !tenantId) return null;

  return (
    <div className="mt-8">
      <CloseAccountSection
        tenantId={tenantId}
        tenantName={name}
        lifecycleState={lifecycleState}
        scheduledPurgeAt={scheduledPurgeAt}
      />
    </div>
  );
}
