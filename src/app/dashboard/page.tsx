"use client";

import { useState } from 'react';
import RoleGuard from '@/components/RoleGuard';
import { KpiCard } from '@/components/KpiCard';
import ChatsList from '@/components/chat/ChatsList';
import CustomersList from '@/components/customers/CustomersList';
import ServicesList from '@/components/services/ServicesList';
// RoleGuard import removed (unused after refactor)
import { classes } from '@/styles/tokens';

export default function TenantDashboardPage() {
  const [tenantId] = useState<string | null>(() => {
    try {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const paramTid = params.get('tenantId');
        if (paramTid) {
          localStorage.setItem('boka_auth_tenant_id', paramTid);
          return paramTid;
        }
        // Check new storage first
        const newTenant = localStorage.getItem('boka_auth_tenant_id');
        if (newTenant) return newTenant;
        // Fall back to old storage for backward compatibility
        const raw = localStorage.getItem('current_tenant');
        const t = raw ? JSON.parse(raw) : null;
        return t?.id ?? null;
      }
    } catch {}
    return null;
  });
  const [role] = useState<string | null>(() => {
    try { 
      if (typeof window !== 'undefined') {
        // Check new storage first
        const newRole = localStorage.getItem('boka_auth_role');
        if (newRole) return newRole;
        // Fall back to old storage for backward compatibility
        return localStorage.getItem('current_tenant_role') ?? null;
      }
    } catch {}
    return null;
  });

  // Owner sees full dashboard (calendar + list + chats). Staff sees a compact
  // view focused on chats and today's reservations.
  return (
    <RoleGuard allowedRoles={['owner','manager','staff']}>
      <div className={classes.page}>
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Tenant Dashboard</h1>
          <p className="text-sm text-gray-600">Tenant ID: {tenantId ?? '—'} · Role: {role ?? 'loading...'}</p>
        </header>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          <KpiCard title="Bookings Today" value={42} delta={5.3} trend="up" ariaLabel="Bookings Today KPI" />
          <KpiCard title="No-Show Rate" value={'3%'} delta={-1.1} trend="down" ariaLabel="No-show rate KPI" />
          <KpiCard title="Deposit Conversion" value={'67%'} trend="flat" ariaLabel="Deposit conversion KPI" />
          <KpiCard title="MRR" value={'$12.3k'} delta={2.0} trend="up" ariaLabel="Monthly Recurring Revenue KPI" />
          <KpiCard title="Active Staff" value={8} trend="flat" ariaLabel="Active staff on shift" />
          <KpiCard title="Pending Payments" value={5} trend="up" ariaLabel="Outstanding payment links" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <aside className="lg:col-span-1 order-last lg:order-0 space-y-4">
            <section className={classes.section.replace('p-5','p-4')}>
              <h3 className="font-semibold mb-2 text-sm">Chats</h3>
              <ChatsList />
            </section>
          </aside>
          <div className="lg:col-span-2 space-y-4">
            <section className={classes.section}>
              <h3 className="font-semibold mb-2 text-sm">Activity & Metrics Roadmap</h3>
              <p className="text-sm leading-relaxed text-gray-600">Calendar & detailed reservations moved to <strong>Schedule</strong>. This dashboard will evolve to show richer trend charts (MRR, conversion funnels, utilization).</p>
            </section>
            {role?.toLowerCase() === 'owner' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <section className={classes.section}>
                  <h3 className="font-semibold mb-2 text-sm">Customers</h3>
                  <CustomersList tenantId={tenantId ?? undefined} />
                </section>
                <section className={classes.section}>
                  <h3 className="font-semibold mb-2 text-sm">Services</h3>
                  <ServicesList />
                </section>
              </div>
            )}
          </div>
        </div>

        {/* Removed duplicate owner panels to avoid duplication */}
      </div>
    </RoleGuard>
  );
}
