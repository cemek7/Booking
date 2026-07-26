export const dynamic = 'force-dynamic';
import Link from 'next/link';
import { Metadata } from 'next';
import { ArrowRight, BarChart3, CalendarDays, CheckSquare, ClipboardList, LifeBuoy, MessageCircle, ShoppingBag } from 'lucide-react';
import { requireAuth } from '@/lib/auth/server-auth';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';
import { Badge } from '@/components/ui/badge';

export const metadata: Metadata = {
  title: 'Staff Dashboard | Booka',
  description: 'Staff schedule and task management dashboard',
};

// Only routes staff can actually open (middleware-allowed, pages exist).
const QUICK_LINKS = [
  {
    href: '/dashboard/bookings',
    title: 'My Bookings',
    description: 'Reservations and appointments assigned to you.',
    icon: ClipboardList,
  },
  {
    href: '/dashboard/schedule',
    title: 'My Schedule',
    description: 'Your shifts and availability at a glance.',
    icon: CalendarDays,
  },
  {
    href: '/dashboard/tasks',
    title: 'Tasks',
    description: 'View and manage your assigned tasks.',
    icon: CheckSquare,
  },
  {
    href: '/dashboard/chats',
    title: 'Messages',
    description: 'Customer conversations and team messages.',
    icon: MessageCircle,
  },
  {
    href: '/dashboard/orders',
    title: 'Orders',
    description: 'Retail orders from WhatsApp and Instagram chats.',
    icon: ShoppingBag,
  },
  {
    href: '/dashboard/staff-dashboard/analytics',
    title: 'My Performance',
    description: 'Detailed personal performance metrics.',
    icon: BarChart3,
  },
  {
    href: '/dashboard/support',
    title: 'Support',
    description: 'Get help or raise an issue with the team.',
    icon: LifeBuoy,
  },
];

export default async function StaffDashboardPage() {
  const user = await requireAuth(['staff', 'manager', 'owner']);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-3xl border border-emerald-100 bg-[radial-gradient(circle_at_top_left,_#f0fdf4,_#ffffff_55%,_#f8fbf9_100%)] shadow-sm">
        <div className="flex flex-col gap-6 p-6 lg:p-8">
          <div className="max-w-3xl space-y-3">
            <Badge variant="outline" className="w-fit rounded-full border-emerald-100 bg-white px-3 py-1 text-emerald-700">
              Staff view
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-[#10211a]">Your day at a glance</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Your schedule, bookings, tasks, and conversations &mdash; everything you need for the shift ahead.
              </p>
            </div>
          </div>
        </div>
      </div>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">My performance</h2>
          <p className="text-sm text-slate-500">How your bookings and customer work are trending.</p>
        </div>
        <div className="p-4 sm:p-6">
          <AnalyticsDashboard tenantId={user.tenantId} userRole={user.role} userId={user.id} />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Quick actions</h2>
          <p className="text-sm text-slate-500">The things you&rsquo;ll reach for most, one tap away.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {QUICK_LINKS.map(({ href, title, description, icon: Icon }) => (
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
