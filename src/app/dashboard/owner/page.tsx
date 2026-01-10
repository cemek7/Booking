import Link from "next/link";
import { requireAuth } from '@/lib/auth/server-auth';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';

export default async function OwnerDashboardPage() {
  const user = await requireAuth(['owner']);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Owner Dashboard</h1>

      <p className="text-sm text-muted-foreground mb-6">
        Welcome back! Manage your business operations and view comprehensive analytics.
      </p>

      {/* Integrated Analytics */}
      <div className="mb-8">
        <h2 className="text-lg font-medium mb-4">Business Analytics</h2>
        <AnalyticsDashboard 
          tenantId={user.tenantId} 
          userRole={user.role}
          userId={user.id}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link href="/dashboard/owner/analytics" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">📊 Business Analytics</h3>
          <p className="text-sm text-muted-foreground">Detailed business performance and financial insights.</p>
        </Link>

        <Link href="/dashboard/owner/schedule" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">📅 My Schedule</h3>
          <p className="text-sm text-muted-foreground">Full calendar with bookings and staff assignments.</p>
        </Link>

        <Link href="/dashboard/staff" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">👥 Staff Management</h3>
          <p className="text-sm text-muted-foreground">Invite team, manage roles, assign responsibilities.</p>
        </Link>

        <Link href="/dashboard/chats" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">💬 Customer Messages</h3>
          <p className="text-sm text-muted-foreground">View all customer communications and team chats.</p>
        </Link>

        <Link href="/dashboard/bookings" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">📋 Bookings</h3>
          <p className="text-sm text-muted-foreground">Manage reservations and customer appointments.</p>
        </Link>

        <Link href="/dashboard/customers" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">🧑 Customers</h3>
          <p className="text-sm text-muted-foreground">Search and manage your customer database.</p>
        </Link>

        <Link href="/dashboard/services" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">🎯 Services</h3>
          <p className="text-sm text-muted-foreground">Manage services offered to customers.</p>
        </Link>

        <Link href="/dashboard/products" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">🛍️ Products & Inventory</h3>
          <p className="text-sm text-muted-foreground">Manage products and inventory levels.</p>
        </Link>

        <Link href="/dashboard/reports" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">📈 Reports</h3>
          <p className="text-sm text-muted-foreground">Generate comprehensive business reports.</p>
        </Link>

        <Link href="/dashboard/settings" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">⚙️ Settings</h3>
          <p className="text-sm text-muted-foreground">Configure preferences and LLM settings.</p>
        </Link>

        <Link href="/dashboard/billing" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">💳 Billing & Usage</h3>
          <p className="text-sm text-muted-foreground">Manage subscription and usage metrics.</p>
        </Link>

        <Link href="/dashboard/usage" className="p-4 border rounded hover:shadow transition bg-white">
          <h3 className="font-medium">📊 Usage Analytics</h3>
          <p className="text-sm text-muted-foreground">Track feature usage and system performance.</p>
        </Link>
      </div>
    </div>
  );
}
