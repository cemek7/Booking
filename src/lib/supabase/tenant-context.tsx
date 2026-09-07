"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { DEFAULT_CAPABILITIES, type TenantCapabilities } from "@/lib/capabilities";

type Tenant = { id: string } | null;

type TenantContextValue = {
  tenant: Tenant;
  role?: string | null;
  /** Which Booka workflows this tenant runs (server-seeded; all-on by default). */
  capabilities: TenantCapabilities;
  setTenant: (t: Tenant, role?: string | null) => void;
  clearTenant: () => void;
};

export const TenantContext = createContext<TenantContextValue | undefined>(undefined);

interface TenantProviderProps {
  children: React.ReactNode;
  /** Server-resolved tenant ID — when provided the context is seeded immediately
   *  with no localStorage lookup. Also persists to localStorage for offline use. */
  initialTenantId?: string;
  /** Server-resolved role — paired with initialTenantId. */
  initialRole?: string;
  /** Server-resolved tenant capabilities — all-on when omitted. */
  initialCapabilities?: TenantCapabilities;
}

export function TenantProvider({ children, initialTenantId, initialRole, initialCapabilities }: TenantProviderProps) {
  // Capabilities are resolved server-side per request; no client state needed.
  const capabilities = initialCapabilities ?? DEFAULT_CAPABILITIES;
  const isSuperadmin = initialRole === 'superadmin';
  // Seed state immediately from server-provided values when available.
  const [tenant, setTenantState] = useState<Tenant>(
    initialTenantId && !isSuperadmin && initialTenantId !== 'global'
      ? { id: initialTenantId }
      : null
  );
  const [role, setRole] = useState<string | null>(initialRole ?? null);

  useEffect(() => {
    let mounted = true;

    // When seeded from the server, just persist to localStorage and return.
    if (initialRole === 'superadmin') {
      try {
        localStorage.removeItem('boka_auth_tenant_id');
        localStorage.removeItem('boka_auth_role');
        localStorage.removeItem('current_tenant');
        localStorage.removeItem('current_tenant_role');
      } catch {}
      return;
    }

    if (initialTenantId && initialRole) {
      try {
        localStorage.setItem('boka_auth_tenant_id', initialTenantId);
        localStorage.setItem('boka_auth_role', initialRole);
      } catch {}
      return;
    }

    // No server seed — fall back to localStorage (handles edge cases like
    // the layout not passing props, or non-dashboard contexts).
    async function load() {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const isAdmin = typeof window !== 'undefined'
            ? localStorage.getItem('boka_auth_is_admin') === 'true'
            : false;
          const tenantId = typeof window !== 'undefined'
            ? localStorage.getItem('boka_auth_tenant_id')
            : null;
          const userRole = typeof window !== 'undefined'
            ? localStorage.getItem('boka_auth_role')
            : null;

          if (isAdmin) {
            if (mounted) {
              setTenantState(null);
              setRole('superadmin');
            }
            return;
          }

          if (tenantId && userRole) {
            if (mounted) {
              setTenantState({ id: tenantId });
              setRole(userRole);
            }
            return;
          }

          const oldRaw = typeof window !== 'undefined'
            ? localStorage.getItem('current_tenant')
            : null;
          const oldRole = typeof window !== 'undefined'
            ? localStorage.getItem('current_tenant_role')
            : null;

          if (oldRaw && oldRole) {
            try {
              const oldTenant = JSON.parse(oldRaw);
              if (oldTenant?.id) {
                localStorage.setItem('boka_auth_tenant_id', oldTenant.id);
                localStorage.setItem('boka_auth_role', oldRole);
                if (mounted) {
                  setTenantState({ id: oldTenant.id });
                  setRole(oldRole);
                }
                return;
              }
            } catch {}
          }

          if (attempt < 2) await new Promise(r => setTimeout(r, 150));
        }
      } catch {}
    }
    load();
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setTenant(t: Tenant, roleArg?: string | null) {
    setTenantState(t);
    setRole(roleArg ?? null);
    try {
      if (typeof window !== 'undefined') {
        const shouldPersistTenant = !!t && roleArg !== 'superadmin' && t.id !== 'global';

        if (shouldPersistTenant && t) {
          localStorage.setItem('boka_auth_tenant_id', t.id);
          localStorage.setItem('current_tenant', JSON.stringify({ id: t.id }));
        } else {
          localStorage.removeItem('boka_auth_tenant_id');
          localStorage.removeItem('current_tenant');
        }
        if (roleArg && roleArg !== 'superadmin') {
          localStorage.setItem('boka_auth_role', roleArg);
          localStorage.setItem('current_tenant_role', roleArg);
        } else {
          localStorage.removeItem('boka_auth_role');
          localStorage.removeItem('current_tenant_role');
        }
      }
    } catch {}
  }

  function clearTenant() {
    setTenantState(null);
    setRole(null);
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('boka_auth_tenant_id');
        localStorage.removeItem('boka_auth_role');
        localStorage.removeItem('current_tenant');
        localStorage.removeItem('current_tenant_role');
      }
    } catch {}
  }

  return (
    <TenantContext.Provider value={{ tenant, role, capabilities, setTenant, clearTenant }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant must be used within TenantProvider');
  return ctx;
}

export const useTenantContext = useTenant;

export default TenantProvider;
