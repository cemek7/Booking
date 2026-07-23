export const dynamic = 'force-dynamic';
import Link from "next/link";
import { Activity, ArrowRight, BarChart3, CalendarDays, ClipboardList, DollarSign, FileText, ImagePlus, MessageCircle, Package, Settings2, Users } from 'lucide-react';
import { requireAuth } from '@/lib/auth/server-auth';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';
import { Badge } from '@/components/ui/badge';
import { CardContent } from '@/components/ui/card';

const quickLinks = [
  {
    href: '/dashboard/owner/analytics',
    title: 'Business Analytics',
    description: 'Detailed performance, revenue, and growth insights.',
    icon: BarChart3,
  },
  {
    href: '/dashboard/owner/schedule',
    title: 'My Schedule',
    description: 'Full calendar with bookings and staff assignments.',
    icon: CalendarDays,
  },
  {
    href: '/dashboard/staff',
    title: 'Staff Management',
    description: 'Invite the team, assign roles, and keep responsibilities clear.',
    icon: Users,
  },
  {
    href: '/dashboard/chats',
    title: 'Customer Messages',
    description: 'View customer chats and respond without losing context.',
    icon: MessageCircle,
  },
  {
    href: '/dashboard/bookings',
    title: 'Bookings',
    description: 'Manage reservations and customer appointments.',
    icon: ClipboardList,
  },
  {
    href: '/dashboard/services',
    title: 'Services',
    description: 'Set up the services you offer and their prices.',
    icon: Package,
  },
  {
    href: '/dashboard/customers',
    title: 'Customers',
    description: 'Find and manage the people you serve.',
    icon: Users,
  },
  {
    href: '/dashboard/products',
    title: 'Products & Inventory',
    description: 'Track retail items and stock levels in one place.',
    icon: Package,
  },
  {
    href: '/dashboard/showcase',
    title: 'Showcase Packs',
    description: 'Build media packs that can be sent inside WhatsApp chats.',
    icon: ImagePlus,
  },
  {
    href: '/dashboard/reports',
    title: 'Reports',
    description: 'See how your business is trending over time.',
    icon: FileText,
  },
  {
    href: '/dashboard/settings',
    title: 'Settings',
    description: 'Your business details, team, and how your assistant replies.',
    icon: Settings2,
  },
  {
    href: '/dashboard/billing',
    title: 'Billing & Usage',
    description: 'See your plan and balance, and top up when you need to.',
    icon: DollarSign,
  },
  {
    href: '/dashboard/usage',
    title: 'Usage Analytics',
    description: 'See which features you use most.',
    icon: Activity,
  },
];

export default async function OwnerDashboardPage() {
  const user = await requireAuth(['owner']);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-slate-50 shadow-sm">
        <div className="flex flex-col gap-6 p-6 lg:p-8 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl space-y-3">
            <Badge variant="outline" className="w-fit rounded-full border-slate-200 bg-white px-3 py-1 text-slate-600">
              Owner dashboard
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Your business at a glance</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Here&rsquo;s how things are going today — bookings, sales, your team, and anything that needs your attention.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">How business is going</h2>
              <p className="text-sm text-slate-500">Bookings, sales, revenue, and customers at a glance.</p>
            </div>
            <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
              Live data
            </Badge>
          </div>
        </div>
        <CardContent className="p-4 sm:p-6">
          <AnalyticsDashboard
            tenantId={user.tenantId}
            userRole={user.role}
            userId={user.id}
          />
        </CardContent>
      </section>

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
