'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Role } from '@/types/roles';
import { canAccessRoute, getRoleDashboardPath } from '@/types/unified-permissions';

interface UnifiedDashboardNavProps {
  userRole: Role;
  onNavigate?: () => void;
}

// ── Inline SVG icons (20×20 viewBox) ──────────────────────────────────────────

const Icons = {
  dashboard: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="11" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  bookings: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.5" y="3.5" width="15" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 2v3M13 2v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2.5 8.5h15" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 12h7M6.5 15h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  schedule: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v4.5l3 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  services: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 2l2.09 4.26L17 7.27l-3.5 3.41.83 4.82L10 13.27l-4.33 2.23.83-4.82L3 7.27l4.91-.71L10 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  customers: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="8" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 17c0-3.31 2.69-6 6-6s6 2.69 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 5a3 3 0 010 6M18 17c0-2.67-1.79-4.93-4.27-5.66" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  staff: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 17c0-3.31 2.69-6 6-6s6 2.69 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  analytics: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M2 15l5-5 4 3 5-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 18h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  reports: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="2" width="14" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  showcase: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 12l2.5-3 2 2 2.5-3.5 1.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="7" r="1" fill="currentColor" />
    </svg>
  ),
  chats: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v9a1 1 0 01-1 1H7l-4 3V4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M15.78 4.22l-1.42 1.42M5.64 14.36l-1.42 1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  billing: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2" y="5" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 9h16" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 13h2M10 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  faqs: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.5 8a2.5 2.5 0 015 .5c0 1.5-2.5 2-2.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="14.5" r="0.75" fill="currentColor" />
    </svg>
  ),
  tasks: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M8 10l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  superadmin: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="9" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 9V6a3 3 0 016 0v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="14" r="1.5" fill="currentColor" />
    </svg>
  ),
};

// ── Navigation group definitions by role ──────────────────────────────────────

interface NavItemDef {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles: Role[];
}

interface NavGroupDef {
  title: string;
  items: NavItemDef[];
}

const ALL_NAV_ITEMS: NavItemDef[] = [
  // Shared dashboard home — role-specific href resolved separately
  // Bookings
  { href: '/dashboard/bookings', label: 'Bookings', icon: Icons.bookings, roles: ['owner', 'manager', 'staff'] },
  // Schedule (owner / manager / staff each have own path)
  { href: '/dashboard/owner/schedule', label: 'Schedule', icon: Icons.schedule, roles: ['owner'] },
  { href: '/dashboard/manager/schedule', label: 'Schedule', icon: Icons.schedule, roles: ['manager'] },
  // Services
  { href: '/dashboard/services', label: 'Services', icon: Icons.services, roles: ['owner', 'manager'] },
  // Customers
  { href: '/dashboard/customers', label: 'Customers', icon: Icons.customers, roles: ['owner', 'manager', 'staff'] },
  // Staff
  { href: '/dashboard/staff', label: 'Staff', icon: Icons.staff, roles: ['owner', 'manager'] },
  // Analytics
  { href: '/dashboard/owner/analytics', label: 'Analytics', icon: Icons.analytics, roles: ['owner'] },
  { href: '/dashboard/manager/analytics', label: 'Analytics', icon: Icons.analytics, roles: ['manager'] },
  // Reports
  { href: '/dashboard/reports', label: 'Reports', icon: Icons.reports, roles: ['owner', 'manager'] },
  // Showcase packs
  { href: '/dashboard/showcase', label: 'Showcase', icon: Icons.showcase, roles: ['owner', 'manager'] },
  // Chats
  { href: '/dashboard/chats', label: 'Chats', icon: Icons.chats, roles: ['owner', 'manager', 'staff'] },
  // Settings
  { href: '/dashboard/settings', label: 'Settings', icon: Icons.settings, roles: ['owner'] },
  // Billing
  { href: '/dashboard/billing', label: 'Billing', icon: Icons.billing, roles: ['owner'] },
  // FAQs
  { href: '/dashboard/faqs', label: 'FAQs', icon: Icons.faqs, roles: ['owner'] },
  // Tasks
  { href: '/dashboard/tasks', label: 'Tasks', icon: Icons.tasks, roles: ['manager', 'staff'] },
  // Super admin
  { href: '/dashboard/superadmin', label: 'Super Admin', icon: Icons.superadmin, roles: ['superadmin'] },
];

const ROLE_GROUPS: Record<Role, NavGroupDef[]> = {
  owner: [
    {
      title: 'Overview',
      items: [], // Dashboard home injected dynamically
    },
    {
      title: 'Manage',
      items: [
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/bookings')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/owner/schedule')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/services')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/customers' && i.roles.includes('owner'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/staff' && i.roles.includes('owner'))!,
      ],
    },
    {
      title: 'Intelligence',
      items: [
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/owner/analytics')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/reports' && i.roles.includes('owner'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/showcase' && i.roles.includes('owner'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/chats' && i.roles.includes('owner'))!,
      ],
    },
    {
      title: 'Settings',
      items: [
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/settings')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/billing')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/faqs')!,
      ],
    },
  ],
  manager: [
    {
      title: 'Overview',
      items: [],
    },
    {
      title: 'Manage',
      items: [
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/bookings')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/manager/schedule')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/staff' && i.roles.includes('manager'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/customers' && i.roles.includes('manager'))!,
      ],
    },
    {
      title: 'Intelligence',
      items: [
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/manager/analytics')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/reports' && i.roles.includes('manager'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/chats' && i.roles.includes('manager'))!,
      ],
    },
    {
      title: 'Settings',
      items: [
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/tasks' && i.roles.includes('manager'))!,
      ],
    },
  ],
  staff: [
    {
      title: 'My Work',
      items: [],
    },
    {
      title: 'Communication',
      items: [
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/chats' && i.roles.includes('staff'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/tasks' && i.roles.includes('staff'))!,
      ],
    },
  ],
  superadmin: [
    {
      title: 'System',
      items: [
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/superadmin')!,
      ],
    },
  ],
};

// ── Role label ─────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
  superadmin: 'Super Admin',
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function UnifiedDashboardNav({ userRole, onNavigate }: UnifiedDashboardNavProps) {
  const pathname = usePathname();

  const dashboardHref = getRoleDashboardPath(userRole);

  const groups = ROLE_GROUPS[userRole] ?? [];

  // Build groups with Dashboard home injected into the first group's Overview
  const resolvedGroups: NavGroupDef[] = groups.map((group, idx) => {
    if (idx === 0) {
      const dashboardItem: NavItemDef = {
        href: dashboardHref,
        label: 'Dashboard',
        icon: Icons.dashboard,
        roles: [userRole],
      };
      return { ...group, items: [dashboardItem, ...group.items] };
    }
    return group;
  });

  // Filter each group's items through the permission system, drop empty groups
  const permittedGroups = resolvedGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => item && item.roles.includes(userRole) && canAccessRoute(userRole, item.href)
      ),
    }))
    .filter((group) => group.items.length > 0);

  const isActive = (href: string) => pathname === href;

  return (
    <nav className="flex flex-col gap-4" aria-label="Main navigation">
      {permittedGroups.map((group) => (
        <div key={group.title}>
          <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400 select-none">
            {group.title}
          </p>
          <ul className="space-y-0.5" role="list">
            {group.items.map((item) => (
              <li key={`${item.href}-${item.label}`} className="relative">
                {isActive(item.href) && (
                  <span
                    className="absolute left-0 inset-y-1 w-0.5 bg-indigo-600 rounded-full"
                    aria-hidden="true"
                  />
                )}
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 pl-4 pr-3 py-2 rounded-lg text-sm transition-colors w-full',
                    isActive(item.href)
                      ? 'bg-indigo-50 text-indigo-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  )}
                  onClick={onNavigate}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                >
                  <span
                    className={cn(
                      'flex-shrink-0',
                      isActive(item.href) ? 'text-indigo-600' : 'text-gray-400'
                    )}
                    aria-hidden="true"
                  >
                    {item.icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* Role footer */}
      <div className="mt-auto pt-3 border-t border-gray-100">
        <div className="px-4 py-2">
          <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
            {ROLE_LABELS[userRole]}
          </p>
        </div>
      </div>
    </nav>
  );
}
