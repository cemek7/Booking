'use client';

import React, { useEffect, useState } from 'react';
import CustomerDsarControl from './CustomerDsarControl';

/**
 * Reads the current tenant (same source as the settings client) and renders the
 * DSAR control. Lets CustomerDsarControl stay a pure, prop-driven, tested unit
 * while still mounting in the settings host without editing it.
 */
export default function CustomerDsarLoader() {
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('current_tenant') : null;
      const current = raw ? JSON.parse(raw) : null;
      setTenantId(current?.id ?? null);
    } catch {
      // ignore
    }
  }, []);

  if (!tenantId) return null;
  return (
    <div className="mt-4 max-w-2xl">
      <CustomerDsarControl tenantId={tenantId} />
    </div>
  );
}
