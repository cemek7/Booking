import { requireAuth } from '@/lib/auth/server-auth';
import { Metadata } from 'next';
import OwnerMetrics from '@/components/analytics/OwnerMetrics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Business Analytics | Booka',
  description: 'Complete business analytics and performance metrics',
};

export default async function OwnerAnalyticsPage() {
  const user = await requireAuth(['owner']);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Business Analytics
          </h1>
          <p className="text-muted-foreground">
            Comprehensive business performance, financial insights, and growth
            metrics
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/owner">← Back to Dashboard</Link>
          </Button>
        </div>
      </div>

      {/* Main Analytics Dashboard */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Business Performance Dashboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          <OwnerMetrics tenantId={user.tenantId} />
        </CardContent>
      </Card>
    </div>
  );
}
