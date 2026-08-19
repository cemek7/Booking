export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth/server-auth';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CalendarDays,
  ClipboardList,
  DollarSign,
  FileText,
  HelpCircle,
  ImagePlus,
  MessageCircle,
  Package,
  Settings2,
  ShoppingBag,
  UserPlus,
  Users,
} from 'lucide-react';
import DashboardKpis from '@/components/dashboard/DashboardKpis';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { getTenantCapabilities, isRouteEnabled } from '@/lib/capabilities';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
  superadmin: 'Super Admin',
};

interface QuickLink {
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

// The AI front desk pillars: booking, sales, inventory, CRM, staff management.
const OWNER_QUICK_LINKS: QuickLink[] = [
  { href: '/dashboard/bookings', title: 'Bookings', description: 'Manage reservations and customer appointments.', icon: ClipboardList },
  { href: '/dashboard/owner/schedule', title: 'My Schedule', description: 'Full calendar with bookings and staff assignments.', icon: CalendarDays },
  { href: '/dashboard/orders', title: 'Orders', description: 'Retail sales made through WhatsApp and Instagram chats.', icon: ShoppingBag },
  { href: '/dashboard/products', title: 'Products & Inventory', description: 'Track retail items and stock levels in one place.', icon: Package },
  { href: '/dashboard/services', title: 'Services', description: 'Set up the services you offer and their prices.', icon: Package },
  { href: '/dashboard/customers', title: 'Customers', description: 'Find and manage the people you serve.', icon: Users },
  { href: '/dashboard/leads', title: 'Leads', description: 'Prospects your AI front desk is warming up for you.', icon: UserPlus },
  { href: '/dashboard/staff', title: 'Staff Management', description: 'Invite the team, assign roles, and keep responsibilities clear.', icon: Users },
  { href: '/dashboard/chats', title: 'Customer Messages', description: 'View customer chats and respond without losing context.', icon: MessageCircle },
  { href: '/dashboard/owner/analytics', title: 'Business Analytics', description: 'Detailed performance, revenue, and growth insights.', icon: BarChart3 },
  { href: '/dashboard/owner/llm-metrics', title: 'AI Metrics', description: 'How your AI front desk is performing and what it costs.', icon: BrainCircuit },
  // Operational Intelligence surfaces (owner sub-pages under /dashboard/owner/*).
  { href: '/dashboard/owner/close-reports', title: 'Daily Close', description: 'Review expected revenue, recorded payments, and unresolved gaps.', icon: DollarSign },
  { href: '/dashboard/owner/anomalies', title: 'Anomaly Review', description: 'Work through unresolved revenue, refund, and stock exceptions.', icon: AlertTriangle },
  { href: '/dashboard/owner/approvals', title: 'Approvals Queue', description: 'Review discounts, refunds, and inventory changes waiting for sign-off.', icon: ClipboardList },
  { href: '/dashboard/owner/stock-counts', title: 'Stock Counts', description: 'Run physical counts, review variance, and approve shrinkage adjustments.', icon: Package },
  { href: '/dashboard/owner/capture', title: 'Capture Review', description: 'Turn receipts, stock sheets, and voice notes into review-ready records.', icon: ImagePlus },
  { href: '/dashboard/showcase', title: 'Showcase Packs', description: 'Build media packs that can be sent inside WhatsApp chats.', icon: ImagePlus },
  { href: '/dashboard/reports', title: 'Reports', description: 'See how your business is trending over time.', icon: FileText },
  { href: '/dashboard/faqs', title: 'FAQs', description: 'Teach your assistant the answers customers ask for most.', icon: HelpCircle },
  { href: '/dashboard/settings', title: 'Settings', description: 'Your business details, team, and how your assistant replies.', icon: Settings2 },
  { href: '/dashboard/billing', title: 'Billing & Usage', description: 'See your plan and balance, and top up when you need to.', icon: DollarSign },
  { href: '/dashboard/usage', title: 'Usage Analytics', description: 'See which features you use most.', icon: Activity },
];

const MANAGER_QUICK_LINKS: QuickLink[] = [
  { href: '/dashboard/bookings', title: 'Bookings', description: 'Manage team bookings and reservations.', icon: ClipboardList },
  { href: '/dashboard/manager/schedule', title: 'Team Schedule', description: 'Team calendar and shift management.', icon: CalendarDays },
  { href: '/dashboard/orders', title: 'Orders', description: 'Retail sales made through WhatsApp and Instagram chats.', icon: ShoppingBag },
  { href: '/dashboard/products', title: 'Products & Inventory', description: 'Track retail items and stock levels in one place.', icon: Package },
  { href: '/dashboard/customers', title: 'Customers', description: 'Team customer database and history.', icon: Users },
  { href: '/dashboard/leads', title: 'Leads', description: 'Prospects your AI front desk is warming up for the team.', icon: UserPlus },
  { href: '/dashboard/staff', title: 'Staff Management', description: 'Manage your team members.', icon: Users },
  { href: '/dashboard/chats', title: 'Messages', description: 'Team communications and customer chats.', icon: MessageCircle },
  { href: '/dashboard/manager/analytics', title: 'Team Analytics', description: 'Your team performance and key metrics.', icon: BarChart3 },
  { href: '/dashboard/reports', title: 'Reports', description: 'Team performance and activity reports.', icon: FileText },
  { href: '/dashboard/faqs', title: 'FAQs', description: 'Keep the assistant’s answers accurate and current.', icon: HelpCircle },
  { href: '/dashboard/tasks', title: 'Tasks', description: 'Team task management and assignments.', icon: ClipboardList },
];

const WORKSPACE_GROUPS: Array<{ title: string; description: string; items: readonly string[] }> = [
  { title: 'Today', description: 'Handle live customer work and the next operational decision.', items: ['Bookings', 'My Schedule', 'Team Schedule', 'Orders', 'Customer Messages', 'Messages'] },
  { title: 'Customers & growth', description: 'Build demand and keep customer context useful.', items: ['Customers', 'Leads', 'Business Analytics', 'Team Analytics', 'Reports'] },
  { title: 'Catalogue & delivery', description: 'Keep what you sell, your team, and operations ready.', items: ['Products & Inventory', 'Services', 'Staff Management', 'Tasks', 'FAQs'] },
  { title: 'Control room', description: 'Review exceptions, settings, billing, and intelligence.', items: ['Daily Close', 'Anomaly Review', 'Approvals Queue', 'Stock Counts', 'Capture Review', 'Settings', 'Billing & Usage', 'Usage Analytics', 'AI Metrics', 'Showcase Packs'] },
];

export default async function TenantDashboardPage() {
  const user = await requireAuth(['owner', 'manager', 'staff', 'superadmin']);
  const role = user.role?.toLowerCase() ?? '';

  // Each role has one home. Staff and superadmin have dedicated ones.
  if (role === 'staff') redirect('/dashboard/staff-dashboard');
  if (role === 'superadmin') redirect('/dashboard/superadmin');

  const tenantId = user.tenantId;
  const roleLabel = ROLE_LABEL[role] ?? user.role ?? 'User';
  const isOwner = role === 'owner';
  const rawLinks = isOwner ? OWNER_QUICK_LINKS : MANAGER_QUICK_LINKS;
  const capabilities = tenantId ? await getTenantCapabilities(createSupabaseAdminClient(), tenantId) : undefined;
  const quickLinks = capabilities ? rawLinks.filter((link) => isRouteEnabled(link.href, capabilities)) : rawLinks;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-3xl border border-emerald-100 bg-[radial-gradient(circle_at_top_left,_#f0fdf4,_#ffffff_55%,_#f8fbf9_100%)] shadow-sm">
        <div className="flex flex-col gap-6 p-6 lg:p-8 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl space-y-3">
            <Badge variant="outline" className="w-fit rounded-full border-emerald-100 bg-white px-3 py-1 text-emerald-700">
              {roleLabel} view
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-[#10211a]">Your business at a glance</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Here&rsquo;s how things are going today &mdash; bookings, sales, your team, and anything that needs your attention.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard/ops" className="rounded-full border border-emerald-100 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 shadow-sm hover:bg-emerald-100">
              SIAS ops
            </Link>
            {isOwner && (
              <Link href="/dashboard/billing" className="rounded-full border border-emerald-100 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-emerald-50">
                Billing
              </Link>
            )}
          </div>
        </div>
      </div>

      <DashboardKpis tenantId={tenantId} userId={user.id} userRole={user.role} />

      <section className="space-y-6">
        {WORKSPACE_GROUPS.map((group) => {
          const links = quickLinks.filter((link) => group.items.includes(link.title));
          if (!links.length) return null;
          return (
            <div key={group.title} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5 max-w-2xl">
                <h2 className="text-lg font-semibold text-slate-900">{group.title}</h2>
                <p className="mt-1 text-sm text-slate-500">{group.description}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {links.map(({ href, title, description, icon: Icon }) => (
                  <Link key={href} href={href} className="group flex min-h-32 flex-col justify-between rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-white hover:shadow-md">
                    <div className="flex items-start justify-between gap-3"><span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-100 transition group-hover:bg-[#10211a] group-hover:text-white"><Icon className="h-4 w-4" /></span><ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-700" /></div>
                    <div className="mt-4"><h3 className="text-sm font-semibold text-slate-900">{title}</h3><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{description}</p></div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
