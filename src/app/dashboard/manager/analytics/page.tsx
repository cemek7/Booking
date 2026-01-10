import { requireAuth } from '@/lib/auth/server-auth';
import { Metadata } from 'next';
import RoleBasedAnalytics from '@/components/RoleBasedAnalytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Manager Analytics | Booka',
  description: 'Team performance and operational analytics'
};

export default async function ManagerAnalyticsPage() {
  const user = await requireAuth(['manager', 'owner']);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Team Analytics</h1>
          <p className="text-muted-foreground">
            Operational metrics and team performance insights
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/manager">
              ← Back to Dashboard
            </Link>
          </Button>
          <Button variant="outline">
            Export Team Report
          </Button>
        </div>
      </div>

      {/* Analytics Overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Operational Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RoleBasedAnalytics
            tenantId={user.tenantId}
            userRole={user.role}
            userId={user.id}
          />
        </CardContent>
      </Card>

      {/* Manager-Specific Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Team Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Staff utilization rates, productivity metrics, and team coordination insights are displayed above.
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              Operational Targets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Schedule efficiency, booking optimization, and operational KPIs tracked in the analytics dashboard.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
