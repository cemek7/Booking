import { requireAuth } from '@/lib/auth/server-auth';
import { Metadata } from 'next';
import ManagerMetrics from '@/components/analytics/ManagerMetrics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Team Analytics | Booka',
  description: 'Team performance and operational analytics',
};

export default async function ManagerAnalyticsPage() {
  const user = await requireAuth(['manager', 'owner']);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Team Analytics
          </h1>
          <p className="text-muted-foreground">
            Operational metrics, team performance, and scheduling efficiency
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/manager">← Back to Dashboard</Link>
          </Button>
        </div>
      </div>

      {/* Main Analytics Dashboard */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Team Performance Dashboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ManagerMetrics tenantId={user.tenantId} userId={user.id} />
        </CardContent>
      </Card>
    </div>
  );
}
