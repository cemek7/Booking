"use client";
import React from 'react';
import { useRealtimeClient } from '@/hooks/useRealtimeClient';
import RealtimeSubscriptions from '@/components/RealtimeSubscriptions';
import LocationPicker from '@/components/LocationPicker';

export interface AppShellProps {
  tenantId: string;
  userRole: 'superadmin'|'owner'|'manager'|'staff';
  onLogout: () => void;
  children: React.ReactNode;
}

// Consolidated navigation: per PRD the tenant owner should primarily
// interact with a unified Schedule surface (Calendar + Reservations list).
// We collapse owner navigation to a single Schedule entry; additional
// pages (Settings, Billing) remain routable but are hidden from sidebar.
const navByRole: Record<string, { label: string; href: string }[]> = {
  common: [
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Schedule', href: '/schedule' },
    { label: 'Chat', href: '/chat' }
  ],
  superadmin: [
    { label: 'Tenants', href: '/superadmin/tenants' },
    { label: 'System Logs', href: '/superadmin/logs' },
    { label: 'Clients', href: '/clients' },
    { label: 'Staff', href: '/staff' },
    { label: 'Settings', href: '/settings' },
    { label: 'Select Business', href: '/select-tenant' }
  ],
  owner: [
    { label: 'Clients', href: '/clients' },
    { label: 'Staff', href: '/staff' },
    { label: 'Settings', href: '/settings' },
    { label: 'Select Business', href: '/select-tenant' }
  ],
  manager: [
    { label: 'Clients', href: '/clients' },
    { label: 'Staff', href: '/staff' },
    { label: 'Settings', href: '/settings' }
  ],
  staff: [
    // Staff sees only common + possibly limited settings later
  ]
};

export const AppShell: React.FC<AppShellProps> = ({ tenantId, userRole, onLogout, children }) => {
  const role = userRole;
  const nav = [...navByRole.common, ...(navByRole[role] ?? [])];
  const { status } = useRealtimeClient();
  const indicatorColor = status === 'open' ? 'bg-green-500' : status === 'connecting' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500';

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-4 py-2 border-b bg-white">
        <div className="flex items-center gap-4">
          <span className="font-semibold">Booka</span>
          <span className="text-sm text-gray-500">Tenant: {tenantId || '—'}</span>
        </div>
        <div className="flex items-center gap-4">
          <LocationPicker />
          <div className="flex items-center gap-1" aria-label="realtime-status" title={`Realtime: ${status}`}>
            <span className={`inline-block w-2 h-2 rounded-full ${indicatorColor}`}></span>
            <span className="text-xs text-gray-500">{status}</span>
          </div>
          <span className="text-xs uppercase tracking-wide bg-gray-100 px-2 py-1 rounded">{role}</span>
          <button onClick={onLogout} className="text-sm px-3 py-1 rounded bg-gray-800 text-white">Logout</button>
        </div>
      </header>
      <div className="flex flex-1">
        <nav className="w-52 border-r bg-gray-50 p-3 space-y-1">
          {nav.map(item => (
            <a key={item.href} href={item.href} className="block px-2 py-1 rounded text-sm hover:bg-gray-200">{item.label}</a>
          ))}
        </nav>
        <main className="flex-1 p-6 bg-gray-100">
          <RealtimeSubscriptions />
          {children}
        </main>
      </div>
    </div>
  );
};

export default AppShell;
