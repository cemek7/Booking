import { requireAuth } from '@/lib/auth/server-auth';
import { Metadata } from 'next';
import RoleBasedAnalytics from '@/components/RoleBasedAnalytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { User, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'My Performance | Booka',
  description: 'Personal performance metrics and insights'
};

export default async function StaffAnalyticsPage() {
  const user = await requireAuth(['staff', 'manager', 'owner']);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Performance</h1>
          <p className="text-muted-foreground">
            Your personal metrics, achievements, and growth insights
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/staff-dashboard">
              ← Back to Dashboard
            </Link>
          </Button>
          <Button variant="outline">
            Export My Report
          </Button>
        </div>
      </div>

      {/* Analytics Overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Personal Analytics
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

      {/* Staff-Specific Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Performance Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Your booking performance, customer ratings, and productivity metrics are shown above.
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-4 w-4" />
              Achievements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Track your progress, goals, and professional development milestones.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
