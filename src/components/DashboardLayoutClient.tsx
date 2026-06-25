'use client';

import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Link from 'next/link';
import { useTenant } from '@/lib/supabase/tenant-context';
import TenantProvider from '@/lib/supabase/tenant-context';
import UnifiedDashboardNav from '@/components/UnifiedDashboardNav';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { Role } from '@/types/roles';

// Create a singleton QueryClient for client-side queries
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes (formerly cacheTime)
    },
  },
});

interface DashboardLayoutContentProps {
  children: React.ReactNode;
  /** Pre-resolved from the server — skips async auth check entirely. */
  userEmail?: string;
}

function DashboardLayoutContent({ children, userEmail: initialEmail }: DashboardLayoutContentProps) {
  const { role } = useTenant();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // When the layout passes email from server-auth we know the session is valid —
  // no need to re-verify on the client before showing the chrome.
  const [userEmail] = useState<string | null>(initialEmail ?? null);

  const handleSignOut = async () => {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = '/booka/auth/signin';
  };

  const userRole = (role || 'staff') as Role;
  const avatarInitial = userEmail ? userEmail[0].toUpperCase() : '?';

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* ── Top header bar ── */}
      <header className="h-14 flex-shrink-0 bg-white border-b border-gray-200 shadow-sm flex items-center px-4 z-30">
        {/* Left: hamburger (mobile) + logo */}
        <div className="flex items-center gap-3">
          {/* Mobile hamburger */}
          <button
            type="button"
            className="lg:hidden inline-flex items-center justify-center p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 select-none" aria-label="Boka home">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <rect x="1" y="1" width="5" height="5" rx="1" fill="white" />
                <rect x="8" y="1" width="5" height="5" rx="1" fill="white" opacity="0.7" />
                <rect x="1" y="8" width="5" height="5" rx="1" fill="white" opacity="0.7" />
                <rect x="8" y="8" width="5" height="5" rx="1" fill="white" opacity="0.4" />
              </svg>
            </div>
            <span className="text-lg font-bold text-gray-900 tracking-tight">boka</span>
          </Link>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: user info + sign out */}
        <div className="flex items-center gap-3">
          {userEmail && (
            <span className="hidden sm:block text-sm text-gray-500 max-w-[200px] truncate">
              {userEmail}
            </span>
          )}
          {/* Avatar */}
          <div
            className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold flex-shrink-0 select-none"
            aria-hidden="true"
          >
            {avatarInitial}
          </div>
          {/* Sign out */}
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M10.5 11L14 8l-3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      {/* ── Body: sidebar + main ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex lg:flex-col w-60 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto">
          <div className="flex flex-col flex-1 px-3 py-4">
            <UnifiedDashboardNav userRole={userRole} />
          </div>
        </aside>

        {/* Mobile slide-over overlay */}
        {sidebarOpen && (
          <div className="lg:hidden fixed inset-0 z-40 flex">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/40 transition-opacity"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
            {/* Drawer */}
            <div className="relative flex flex-col w-72 max-w-full bg-white shadow-xl z-50">
              {/* Drawer header */}
              <div className="h-14 flex items-center justify-between px-4 border-b border-gray-200">
                <span className="text-lg font-bold text-gray-900 tracking-tight">boka</span>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                  aria-label="Close navigation menu"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                    <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              {/* Nav */}
              <div className="flex-1 overflow-y-auto px-3 py-4">
                <UnifiedDashboardNav
                  userRole={userRole}
                  onNavigate={() => setSidebarOpen(false)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 overflow-y-auto bg-gray-50">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

interface DashboardLayoutClientProps {
  children: React.ReactNode;
  initialTenantId?: string;
  initialRole?: string;
  userEmail?: string;
}

export default function DashboardLayoutClient({
  children,
  initialTenantId,
  initialRole,
  userEmail,
}: DashboardLayoutClientProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <TenantProvider initialTenantId={initialTenantId} initialRole={initialRole}>
        <DashboardLayoutContent userEmail={userEmail}>{children}</DashboardLayoutContent>
      </TenantProvider>
    </QueryClientProvider>
  );
}
