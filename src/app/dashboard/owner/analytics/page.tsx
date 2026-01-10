import { requireAuth } from '@/lib/auth/server-auth';
import { Metadata } from 'next';
import RoleBasedAnalytics from '@/components/RoleBasedAnalytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Owner Analytics | Booka',
  description: 'Complete business analytics and performance metrics'
};

export default async function OwnerAnalyticsPage() {
  const user = await requireAuth(['owner']);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Business Analytics</h1>
          <p className="text-muted-foreground">
            Comprehensive business performance and financial insights
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/owner">
              ← Back to Dashboard
            </Link>
          </Button>
          <Button variant="outline">
            Export Report
          </Button>
        </div>
      </div>

      {/* Analytics Overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Full Business Analytics
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

      {/* Additional Owner-Specific Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Financial Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Revenue trends, profit margins, and financial forecasting available in the analytics dashboard above.
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Business Insights</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Customer acquisition, retention metrics, and business growth analytics integrated above.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
