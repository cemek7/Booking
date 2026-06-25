export const dynamic = 'force-dynamic';
import Link from "next/link";
import { Metadata } from 'next';
import { requireAuth } from '@/lib/auth/server-auth';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';

export const metadata: Metadata = {
  title: 'Staff Dashboard | Booka',
  description: 'Staff schedule and task management dashboard'
};

export default async function StaffDashboardPage() {
  const user = await requireAuth(['staff', 'manager', 'owner']);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Staff Dashboard</h1>

      <p className="text-sm text-muted-foreground mb-6">
        View your schedule, assigned tasks, and personal performance metrics.
      </p>

      {/* Personal Performance */}
      <div className="mb-8">
        <h2 className="text-lg font-medium mb-4">My Performance</h2>
        <AnalyticsDashboard 
          tenantId={user.tenantId} 
          userRole={user.role}
          userId={user.id}
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link href="/dashboard/staff-dashboard/analytics" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">📊 My Performance</h3>
          <p className="text-sm text-muted-foreground">Detailed personal performance metrics and achievements.</p>
        </Link>

        <Link href="/dashboard/schedule" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">📅 My Schedule</h3>
          <p className="text-sm text-muted-foreground">View your assigned shifts and availability.</p>
        </Link>

        <Link href="/dashboard/bookings" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">📋 My Bookings</h3>
          <p className="text-sm text-muted-foreground">View bookings assigned to you.</p>
        </Link>

        <Link href="/dashboard/tasks" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">✓ Tasks</h3>
          <p className="text-sm text-muted-foreground">View and manage your assigned tasks.</p>
        </Link>

        <Link href="/dashboard/chats" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">💬 Messages</h3>
          <p className="text-sm text-muted-foreground">Team communications and customer interactions.</p>
        </Link>

        <Link href="/dashboard/customers" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">🧑 Customers</h3>
          <p className="text-sm text-muted-foreground">Customer information and history.</p>
        </Link>

        <Link href="/dashboard/availability" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">⏰ Availability</h3>
          <p className="text-sm text-muted-foreground">Manage your availability and time off requests.</p>
        </Link>

        <Link href="/dashboard/profile" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">👤 My Profile</h3>
          <p className="text-sm text-muted-foreground">Update your profile and preferences.</p>
        </Link>

        <Link href="/dashboard/services" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">🎯 Services</h3>
          <p className="text-sm text-muted-foreground">Services you can provide to customers.</p>
        </Link>
      </div>
    </div>
  );
}