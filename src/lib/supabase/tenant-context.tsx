"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

type Tenant = { id: string } | null;

type TenantContextValue = {
  tenant: Tenant;
  role?: string | null;
  setTenant: (t: Tenant, role?: string | null) => void;
  clearTenant: () => void;
};

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenantState] = useState<Tenant>(null);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        console.debug('[TenantProvider] Loading tenant information...');
        
        // First, try the NEW auth system keys (primary)
        for (let attempt = 0; attempt < 5; attempt++) {
          const tenantId = typeof window !== 'undefined' 
            ? localStorage.getItem('boka_auth_tenant_id')
            : null;
          const userRole = typeof window !== 'undefined' 
            ? localStorage.getItem('boka_auth_role')
            : null;
          
          if (tenantId && userRole) {
            console.log('[TenantProvider] ✓ Found tenant in NEW auth storage (attempt', attempt + 1 + ')');
            console.log('[TenantProvider] Tenant ID:', tenantId);
            console.log('[TenantProvider] Role:', userRole);
            
            if (mounted) {
              setTenantState({ id: tenantId });
              setRole(userRole);
            }
            return;
          }
          
          // Fallback: check OLD keys for backward compatibility
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
                console.warn('[TenantProvider] ⚠ Found tenant in OLD storage (backward compat)');
                
                // Migrate to new keys
                if (typeof window !== 'undefined') {
                  localStorage.setItem('boka_auth_tenant_id', oldTenant.id);
                  localStorage.setItem('boka_auth_role', oldRole);
                }
                
                if (mounted) {
                  setTenantState({ id: oldTenant.id });
                  setRole(oldRole);
                }
                return;
              }
            } catch (e) {
              console.debug('[TenantProvider] Failed to parse old tenant data:', e);
            }
          }
          
          // Wait before retry
          if (attempt < 4) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }

        console.warn('[TenantProvider] ✗ Tenant not found in localStorage after retries');
        
        // If not in localStorage, we might be in a session where it wasn't persisted
        // Fall back to empty state - the user might need to re-signin
        setTenantState(null);
        setRole(null);
      } catch (e) {
        console.error('[TenantProvider] Error loading tenant:', e);
        setTenantState(null);
        setRole(null);
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  function setTenant(t: Tenant, roleArg?: string | null) {
    setTenantState(t);
    setRole(roleArg ?? null);
    // Legacy persistence retained for now (may remove later)
    try {
      if (typeof window !== 'undefined') {
        if (t) localStorage.setItem('current_tenant', JSON.stringify({ id: t.id }));
        else localStorage.removeItem('current_tenant');
        if (roleArg) localStorage.setItem('current_tenant_role', roleArg);
        else localStorage.removeItem('current_tenant_role');
      }
    } catch {}
  }

  function clearTenant() {
    setTenantState(null);
    setRole(null);
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('current_tenant');
        localStorage.removeItem('current_tenant_role');
      }
    } catch {}
  }

  return (
    <TenantContext.Provider value={{ tenant, role, setTenant, clearTenant }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant must be used within TenantProvider');
  return ctx;
}

// Alias for backward compatibility
export const useTenantContext = useTenant;

export default TenantProvider;
