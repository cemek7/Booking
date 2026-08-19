export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/server-auth';
import { Metadata } from 'next';
import SuperAdminMetrics from '@/components/analytics/SuperAdminMetrics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Globe, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import SystemHealthCards from '@/components/superadmin/SystemHealthCards';

export const metadata: Metadata = {
  title: 'Platform Analytics | Booka',
  description: 'System-wide analytics and platform health metrics',
};

export default async function SuperAdminAnalyticsPage() {
  const user = await requireAuth(['superadmin']);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Platform Analytics
          </h1>
          <p className="text-muted-foreground">
            System-wide metrics, tenant performance, and platform health
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/superadmin">← Back to Dashboard</Link>
          </Button>
          <Button variant="outline">
            <Database className="h-4 w-4 mr-2" />
            System Report
          </Button>
        </div>
      </div>

      {/* System Health Status */}
      <SystemHealthCards />

      {/* Main Analytics */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Platform-Wide Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SuperAdminMetrics />
        </CardContent>
      </Card>

      {/* Additional System Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Operational Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Operational metrics are now sourced from the live system dashboard feed.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
