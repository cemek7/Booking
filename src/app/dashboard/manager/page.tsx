import Link from "next/link";
import { Metadata } from 'next';
import { requireAuth } from '@/lib/auth/server-auth';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';

export const metadata: Metadata = {
  title: 'Manager Dashboard | Booka',
  description: 'Manager operations and staff coordination dashboard'
};

export default async function ManagerDashboardPage() {
  const user = await requireAuth(['manager', 'owner']);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Manager Dashboard</h1>

      <p className="text-sm text-muted-foreground mb-6">
        Coordinate your team and manage daily operations with operational analytics.
      </p>

      {/* Operational Analytics */}
      <div className="mb-8">
        <h2 className="text-lg font-medium mb-4">Operational Analytics</h2>
        <AnalyticsDashboard 
          tenantId={user.tenantId} 
          userRole={user.role}
          userId={user.id}
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link href="/dashboard/manager/analytics" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">📊 Team Analytics</h3>
          <p className="text-sm text-muted-foreground">Your team performance and key metrics.</p>
        </Link>

        <Link href="/dashboard/manager/schedule" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">📅 Team Schedule</h3>
          <p className="text-sm text-muted-foreground">Team calendar and shift management.</p>
        </Link>

        <Link href="/dashboard/chats" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">💬 Team Messages</h3>
          <p className="text-sm text-muted-foreground">Team communications and customer chats.</p>
        </Link>

        <Link href="/dashboard/bookings" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">📋 Booking Management</h3>
          <p className="text-sm text-muted-foreground">Manage team bookings and reservations.</p>
        </Link>

        <Link href="/dashboard/staff" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">👥 Staff Management</h3>
          <p className="text-sm text-muted-foreground">Manage your team members.</p>
        </Link>

        <Link href="/dashboard/customers" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">🧑 Customer Base</h3>
          <p className="text-sm text-muted-foreground">Team customer database and history.</p>
        </Link>

        <Link href="/dashboard/reports" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">📈 Reports</h3>
          <p className="text-sm text-muted-foreground">Team performance and activity reports.</p>
        </Link>

        <Link href="/dashboard/tasks" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">✓ Tasks</h3>
          <p className="text-sm text-muted-foreground">Team task management and assignments.</p>
        </Link>

        <Link href="/dashboard/services" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">🎯 Services</h3>
          <p className="text-sm text-muted-foreground">Available services for your team.</p>
        </Link>
      </div>
    </div>
  );
}