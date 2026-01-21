import { requireAuth } from '@/lib/auth/server-auth';
import { Metadata } from 'next';
import StaffMetrics from '@/components/analytics/StaffMetrics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'My Performance | Booka',
  description: 'Personal performance metrics and insights',
};

export default async function StaffAnalyticsPage() {
  const user = await requireAuth(['staff', 'manager', 'owner']);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            My Performance
          </h1>
          <p className="text-muted-foreground">
            Your personal metrics, achievements, and growth insights
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/staff-dashboard">← Back to Dashboard</Link>
          </Button>
        </div>
      </div>

      {/* Main Analytics Dashboard */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Personal Performance Dashboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StaffMetrics userId={user.id} tenantId={user.tenantId} />
        </CardContent>
      </Card>
    </div>
  );
}
