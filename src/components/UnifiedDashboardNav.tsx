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
  orders: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 8h8M6 11h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7 4V2.5M13 4V2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  showcase: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 12l2.5-3 2 2 2.5-3.5 1.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="7" r="1" fill="currentColor" />
    </svg>
  ),
  products: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 2.5l6.5 3.5v8L10 17.5 3.5 14V6L10 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M3.5 6L10 9.5 16.5 6M10 9.5v8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  inventory: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.5" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11.5" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="7" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  chats: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v9a1 1 0 01-1 1H7l-4 3V4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  support: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 17.5A7.5 7.5 0 1010 2.5a7.5 7.5 0 000 15z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.5 8.25a2.5 2.5 0 115 0c0 1.5-2.5 1.9-2.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="14.2" r="0.8" fill="currentColor" />
    </svg>
  ),
  mentions: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 5.5A1.5 1.5 0 015.5 4h9A1.5 1.5 0 0116 5.5v6A1.5 1.5 0 0114.5 13H9l-3.5 3v-3H5.5A1.5 1.5 0 014 11.5v-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7 7.5h6M7 10h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
  { href: '/dashboard/schedule', label: 'My Schedule', icon: Icons.schedule, roles: ['staff'] },
  // Services
  { href: '/dashboard/services', label: 'Services', icon: Icons.services, roles: ['owner', 'manager'] },
  // Customers (middleware allows owner/manager only)
  { href: '/dashboard/customers', label: 'Customers', icon: Icons.customers, roles: ['owner', 'manager'] },
  // Leads — CRM pipeline fed by the AI front desk
  { href: '/dashboard/leads', label: 'Leads', icon: Icons.customers, roles: ['owner', 'manager'] },
  // Staff
  { href: '/dashboard/staff', label: 'Staff', icon: Icons.staff, roles: ['owner', 'manager'] },
  // Analytics
  { href: '/dashboard/owner/analytics', label: 'Analytics', icon: Icons.analytics, roles: ['owner'] },
  { href: '/dashboard/manager/analytics', label: 'Analytics', icon: Icons.analytics, roles: ['manager'] },
  // AI metrics + feature usage (owner)
  { href: '/dashboard/owner/llm-metrics', label: 'AI Metrics', icon: Icons.analytics, roles: ['owner'] },
  { href: '/dashboard/usage', label: 'Usage', icon: Icons.analytics, roles: ['owner'] },
  // Reports
  { href: '/dashboard/reports', label: 'Reports', icon: Icons.reports, roles: ['owner', 'manager'] },
  // Orders
  { href: '/dashboard/orders', label: 'Orders', icon: Icons.orders, roles: ['owner', 'manager', 'staff'] },
  // Commerce: Booka handles sales + inventory, not just bookings.
  { href: '/dashboard/products', label: 'Products', icon: Icons.products, roles: ['owner', 'manager'] },
  { href: '/dashboard/products/inventory', label: 'Inventory', icon: Icons.inventory, roles: ['owner', 'manager'] },
  // Showcase packs
  { href: '/dashboard/showcase', label: 'Showcase', icon: Icons.showcase, roles: ['owner', 'manager'] },
  // Chats
  { href: '/dashboard/chats', label: 'Chats', icon: Icons.chats, roles: ['owner', 'manager', 'staff'] },
  // Support
  { href: '/dashboard/support', label: 'Support', icon: Icons.support, roles: ['owner', 'manager', 'staff'] },
  { href: '/dashboard/superadmin/support', label: 'Support Queue', icon: Icons.support, roles: ['superadmin'] },
  // Social mentions / listening is intentionally not shipped for launch (no
  // reliable provider yet). Nav item removed; the page redirects (see below).
  // { href: '/dashboard/mentions', label: 'Mentions', icon: Icons.mentions, roles: ['owner', 'manager'] },
  // Settings
  { href: '/dashboard/settings', label: 'Settings', icon: Icons.settings, roles: ['owner'] },
  // Billing
  { href: '/dashboard/billing', label: 'Billing', icon: Icons.billing, roles: ['owner'] },
  // FAQs (middleware allows owner + manager; both feed the assistant's answers)
  { href: '/dashboard/faqs', label: 'FAQs', icon: Icons.faqs, roles: ['owner', 'manager'] },
  // Tasks (middleware allows all tenant roles)
  { href: '/dashboard/tasks', label: 'Tasks', icon: Icons.tasks, roles: ['owner', 'manager', 'staff'] },
  // Super admin
  { href: '/dashboard/superadmin', label: 'Super Admin', icon: Icons.superadmin, roles: ['superadmin'] },
  { href: '/dashboard/superadmin/tenants', label: 'Tenants', icon: Icons.staff, roles: ['superadmin'] },
  { href: '/dashboard/superadmin/analytics', label: 'Analytics', icon: Icons.analytics, roles: ['superadmin'] },
  { href: '/dashboard/superadmin/reservations', label: 'Reservations', icon: Icons.bookings, roles: ['superadmin'] },
  { href: '/dashboard/superadmin/reservation-logs', label: 'Reservation Logs', icon: Icons.reports, roles: ['superadmin'] },
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
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/products' && i.roles.includes('owner'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/products/inventory' && i.roles.includes('owner'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/orders' && i.roles.includes('owner'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/customers' && i.roles.includes('owner'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/leads' && i.roles.includes('owner'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/staff' && i.roles.includes('owner'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/tasks' && i.roles.includes('owner'))!,
      ],
    },
    {
      title: 'Intelligence',
      items: [
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/owner/analytics')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/owner/llm-metrics')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/reports' && i.roles.includes('owner'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/showcase' && i.roles.includes('owner'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/chats' && i.roles.includes('owner'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/support' && i.roles.includes('owner'))!,
      ],
    },
    {
      title: 'Settings',
      items: [
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/settings')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/billing')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/usage')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/faqs' && i.roles.includes('owner'))!,
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
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/products' && i.roles.includes('manager'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/products/inventory' && i.roles.includes('manager'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/orders' && i.roles.includes('manager'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/services' && i.roles.includes('manager'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/staff' && i.roles.includes('manager'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/customers' && i.roles.includes('manager'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/leads' && i.roles.includes('manager'))!,
      ],
    },
    {
      title: 'Intelligence',
      items: [
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/manager/analytics')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/reports' && i.roles.includes('manager'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/chats' && i.roles.includes('manager'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/support' && i.roles.includes('manager'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/faqs' && i.roles.includes('manager'))!,
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
      items: [
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/bookings' && i.roles.includes('staff'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/schedule' && i.roles.includes('staff'))!,
      ],
    },
    {
      title: 'Communication',
      items: [
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/orders' && i.roles.includes('staff'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/chats' && i.roles.includes('staff'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/support' && i.roles.includes('staff'))!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/tasks' && i.roles.includes('staff'))!,
      ],
    },
  ],
  superadmin: [
    {
      title: 'System',
      items: [
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/superadmin')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/superadmin/tenants')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/superadmin/analytics')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/superadmin/reservations')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/superadmin/reservation-logs')!,
        ALL_NAV_ITEMS.find((i) => i.href === '/dashboard/superadmin/support')!,
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
