export const dynamic = 'force-dynamic';
import RoleBasedReports from '@/components/reports/RoleBasedReports';
import { requireAuth } from '@/lib/auth/server-auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import RevenueFrontDeskReport from '@/components/reports/RevenueFrontDeskReport';

export default async function ReportsPage() {
  await requireAuth(['owner', 'manager']);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-slate-50 shadow-sm">
        <div className="p-6 lg:p-8">
          <Badge variant="outline" className="w-fit rounded-full border-slate-200 bg-white px-3 py-1 text-slate-600">
            Reports
          </Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">Reports</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Review business performance, trends, and role-based metrics in a layout that is easier to read.
          </p>
        </div>
      </div>
      <RevenueFrontDeskReport />
      <Card className="p-0">
        <CardContent className="p-5">
          <RoleBasedReports />
        </CardContent>
      </Card>
    </div>
  );
}
