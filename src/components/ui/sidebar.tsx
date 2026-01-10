"use client";

import { useTenant } from '@/lib/supabase/tenant-context';
import Link from "next/link";
import GlassCard from "@/components/ui/GlassCard";
import { usePathname } from 'next/navigation';

interface NavItem { href: string; label: string; ownerOnly?: boolean; roles?: string[] }

// Updated spec: single Settings link (tabs handled inside /settings), staff restricted.
const baseNav: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/clients', label: 'Clients', roles: ['owner','superadmin','manager','staff'] },
  { href: '/dashboard/staff', label: 'Staff', roles: ['owner','superadmin','manager'] },
  { href: '/chat', label: 'Chat', roles: ['owner','superadmin','manager','staff'] },
  { href: '/settings', label: 'Settings', roles: ['owner','superadmin','manager'] },
  { href: '/select-tenant', label: 'Select Business', ownerOnly: true }
];

export default function Sidebar() {
  const { role } = useTenant();
  const pathname = usePathname() || '';
  const isOwner = role === 'owner' || role === 'superadmin';
  // Active link highlighting uses pathname match (startsWith for nested future routes)

  const filtered = baseNav.filter(item => {
    if (item.ownerOnly && !isOwner) return false;
    if (item.roles && role && !item.roles.includes(role)) return false;
    return true;
  });

  return (
    <aside className="w-64">
      <GlassCard className="flex flex-col h-full p-0">
        <div className="p-6 font-bold text-xl">Booka</div>
        <nav className="flex-1 overflow-y-auto">
          <ul className="text-sm">
            {filtered.map(item => {
              const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
              return (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`block px-6 py-3 hover:bg-muted transition-colors ${active ? 'bg-muted font-medium border-l-4 border-indigo-600' : ''}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="px-6 py-4 text-xs text-muted-foreground border-t">
          <p className="leading-relaxed">
            Navigation aligned with PRD: unified Schedule, role-gated Select Business.
          </p>
        </div>
      </GlassCard>
    </aside>
  );
}
