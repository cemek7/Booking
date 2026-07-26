export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth/server-auth';
import {
  Activity,
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
import ChatsList from '@/components/chat/ChatsList';
import CustomersList from '@/components/customers/CustomersList';
import ServicesList from '@/components/services/ServicesList';
import DashboardKpis from '@/components/dashboard/DashboardKpis';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import Link from 'next/link';

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

export default async function TenantDashboardPage() {
  const user = await requireAuth(['owner', 'manager', 'staff', 'superadmin']);
  const role = user.role?.toLowerCase() ?? '';

  // Each role has one home. Staff and superadmin have dedicated ones.
  if (role === 'staff') redirect('/dashboard/staff-dashboard');
  if (role === 'superadmin') redirect('/dashboard/superadmin');

  const tenantId = user.tenantId;
  const roleLabel = ROLE_LABEL[role] ?? user.role ?? 'User';
  const isOwner = role === 'owner';
  const quickLinks = isOwner ? OWNER_QUICK_LINKS : MANAGER_QUICK_LINKS;

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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <aside className="order-last space-y-4 xl:order-first xl:col-span-4">
          <Card className="p-0">
            <CardContent className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[#10211a]">Conversations</h3>
                  <p className="text-sm text-slate-500">Live customer and team messages.</p>
                </div>
                <Badge variant="outline" className="rounded-full border-emerald-100 bg-emerald-50 px-3 py-1 text-emerald-700">
                  Inbox
                </Badge>
              </div>
              <ChatsList />
            </CardContent>
          </Card>
        </aside>

        <div className="space-y-6 xl:col-span-8">
          {isOwner && (
            <>
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#10211a]">Customers</h3>
                  <p className="text-sm text-slate-500">Search, edit, and message customers with the full table visible.</p>
                </div>
                <CustomersList tenantId={tenantId ?? undefined} />
              </div>

              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#10211a]">Services</h3>
                  <p className="text-sm text-slate-500">Manage your service catalog without the table feeling cramped.</p>
                </div>
                <ServicesList />
              </div>
            </>
          )}
        </div>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Quick actions</h2>
            <p className="text-sm text-slate-500">The things you&rsquo;ll reach for most, one tap away.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {quickLinks.map(({ href, title, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 transition group-hover:bg-slate-900 group-hover:text-white">
                    <Icon className="h-5 w-5" />
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
