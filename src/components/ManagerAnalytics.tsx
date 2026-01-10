'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';

/**
 * @deprecated This component is deprecated. Use AnalyticsDashboard with role-based props instead.
 * Example: <AnalyticsDashboard userRole="manager" tenantId={tenantId} userId={userId} />
 */

interface ManagerAnalyticsProps {
  tenantId: string;
  className?: string;
}

export default function ManagerAnalytics({ className }: Omit<ManagerAnalyticsProps, 'tenantId'>) {
  console.warn('ManagerAnalytics component is deprecated. Use AnalyticsDashboard with role-based props instead.');
  
  return (
    <div className={className}>
      <Alert className="mb-4">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          This component is deprecated. Analytics are now integrated into the Manager Dashboard.
          Please use AnalyticsDashboard with proper role configuration.
        </AlertDescription>
      </Alert>
      
      <Card>
        <CardHeader>
          <CardTitle>Component Deprecated</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Manager analytics have been moved to the unified AnalyticsDashboard component 
            with role-based access control. This component will be removed in a future version.
          </p>
          <div className="mt-4 p-3 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Migration Guide:</strong> Replace this component with:
              <br />
              <code className="text-xs bg-blue-100 px-1 rounded">
                {'<AnalyticsDashboard userRole="manager" tenantId={tenantId} userId="userId" />'}
              </code>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}