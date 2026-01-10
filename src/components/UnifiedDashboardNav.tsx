'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Role } from "@/types/roles";
import { canAccessRoute, getRoleDashboardPath } from '@/lib/permissions/unified-permissions';

interface UnifiedDashboardNavProps {
  userRole: Role;
}

interface NavItem {
  href: string;
  label: string;
  description?: string;
  roles: Role[];
  icon?: string;
}

const navigationItems: NavItem[] = [
  // OWNER-specific items (12 links)
  {
    href: "/dashboard/owner/analytics",
    label: "Business Analytics",
    description: "Detailed business performance and financial insights",
    roles: ["owner"],
    icon: "📊"
  },
  {
    href: "/dashboard/owner/schedule",
    label: "My Schedule",
    description: "Full calendar with bookings and staff assignments",
    roles: ["owner"],
    icon: "📅"
  },
  {
    href: "/dashboard/staff",
    label: "Staff Management",
    description: "Invite team, manage roles, assign responsibilities",
    roles: ["owner"],
    icon: "👥"
  },
  {
    href: "/dashboard/chats",
    label: "Customer Messages",
    description: "View all customer communications and team chats",
    roles: ["owner"],
    icon: "💬"
  },
  {
    href: "/dashboard/bookings",
    label: "Bookings",
    description: "Manage reservations and customer appointments",
    roles: ["owner", "manager", "staff"],
    icon: "📋"
  },
  {
    href: "/dashboard/customers",
    label: "Customers",
    description: "Search and manage your customer database",
    roles: ["owner", "manager", "staff"],
    icon: "🧑"
  },
  {
    href: "/dashboard/services",
    label: "Services",
    description: "Manage services offered to customers",
    roles: ["owner", "manager"],
    icon: "🎯"
  },
  {
    href: "/dashboard/products",
    label: "Products & Inventory",
    description: "Manage products and inventory levels",
    roles: ["owner"],
    icon: "🛍️"
  },
  {
    href: "/dashboard/reports",
    label: "Reports",
    description: "Generate comprehensive business reports",
    roles: ["owner", "manager"],
    icon: "📈"
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    description: "Configure preferences and LLM settings",
    roles: ["owner"],
    icon: "⚙️"
  },
  {
    href: "/dashboard/billing",
    label: "Billing & Usage",
    description: "Manage subscription and usage metrics",
    roles: ["owner"],
    icon: "💳"
  },
  {
    href: "/dashboard/usage",
    label: "Usage Analytics",
    description: "Track feature usage and system performance",
    roles: ["owner"],
    icon: "📊"
  },

  // MANAGER-specific items (9 links)
  {
    href: "/dashboard/manager/analytics",
    label: "Team Analytics",
    description: "Your team performance and key metrics",
    roles: ["manager"],
    icon: "📊"
  },
  {
    href: "/dashboard/manager/schedule",
    label: "Team Schedule",
    description: "Team calendar and shift management",
    roles: ["manager"],
    icon: "📅"
  },
  {
    href: "/dashboard/chats",
    label: "Team Messages",
    description: "Team communications and customer chats",
    roles: ["manager"],
    icon: "💬"
  },
  {
    href: "/dashboard/bookings",
    label: "Booking Management",
    description: "Manage team bookings and reservations",
    roles: ["manager"],
    icon: "📋"
  },
  {
    href: "/dashboard/staff",
    label: "Staff Management",
    description: "Manage your team members",
    roles: ["manager"],
    icon: "👥"
  },
  {
    href: "/dashboard/customers",
    label: "Customer Base",
    description: "Team customer database and history",
    roles: ["manager"],
    icon: "🧑"
  },
  {
    href: "/dashboard/reports",
    label: "Reports",
    description: "Team performance and activity reports",
    roles: ["manager"],
    icon: "📈"
  },
  {
    href: "/dashboard/tasks",
    label: "Tasks",
    description: "Team task management and assignments",
    roles: ["manager"],
    icon: "✓"
  },
  {
    href: "/dashboard/services",
    label: "Services",
    description: "Available services for your team",
    roles: ["manager"],
    icon: "🎯"
  },

  // STAFF-specific items
  {
    href: "/dashboard/bookings",
    label: "Bookings",
    description: "View assigned bookings",
    roles: ["staff"],
    icon: "📋"
  },
  {
    href: "/dashboard/customers",
    label: "Customers",
    description: "Customer information",
    roles: ["staff"],
    icon: "🧑"
  },
  {
    href: "/dashboard/tasks",
    label: "Tasks",
    description: "View assigned tasks",
    roles: ["staff"],
    icon: "✅"
  },
  {
    href: "/dashboard/chats",
    label: "Messages",
    description: "Team communications",
    roles: ["staff"],
    icon: "💬"
  },

  // Super Admin
  {
    href: "/superadmin",
    label: "Super Admin",
    description: "System administration",
    roles: ["superadmin"],
    icon: "🔐"
  }
];

export default function UnifiedDashboardNav({ userRole }: UnifiedDashboardNavProps) {
  const pathname = usePathname();
  
  // Filter navigation items based on role permissions using unified permission system
  const filteredItems = navigationItems.filter(item => {
    return item.roles.includes(userRole) && canAccessRoute(userRole, item.href);
  });

  // Use unified permission system for role-specific dashboard routing
  const getRoleDashboardLink = () => {
    return getRoleDashboardPath(userRole);
  };

  return (
    <nav className="space-y-1">
      {/* Role-specific dashboard home */}
      <Link
        href={getRoleDashboardLink()}
        className={cn(
          "flex items-start space-x-2 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors",
          pathname === getRoleDashboardLink()
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        )}
      >
        <span className="text-sm mt-0.5">🏠</span>
        <div>
          <div className="leading-tight">Dashboard Home</div>
          <div className="text-xs opacity-70 capitalize">{userRole} View</div>
        </div>
      </Link>

      <div className="h-px bg-border my-1" />

      {/* Navigation items */}
      {filteredItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "flex items-start space-x-2 px-2 py-1.5 rounded-lg text-xs transition-colors",
            pathname === item.href
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          <span className="text-sm mt-0.5">{item.icon}</span>
          <div>
            <div className="font-medium leading-tight">{item.label}</div>
            {item.description && (
              <div className="text-xs opacity-70 leading-snug">{item.description}</div>
            )}
          </div>
        </Link>
      ))}
    </nav>
  );
}