'use client';

import React from 'react';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';
import { Role } from '@/types/roles';

/**
 * @deprecated This component is deprecated. Use AnalyticsDashboard with userRole="staff" instead.
 * Example: <AnalyticsDashboard userRole="staff" tenantId={tenantId} userId={userId} />
 */

interface StaffAnalyticsProps {
  tenantId: string;
  staffId?: string;
  className?: string;
}

export default function StaffAnalytics({ tenantId, staffId, className }: StaffAnalyticsProps) {
  console.warn('StaffAnalytics component is deprecated. Use AnalyticsDashboard with userRole="staff" instead.');
  
  return (
    <div className={className}>
      <Alert className="mb-4">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <strong>Deprecated Component:</strong> StaffAnalytics will be removed in a future version. 
          Please use the unified AnalyticsDashboard component instead.
        </AlertDescription>
      </Alert>
      
      {/* Fallback to unified analytics component */}
      <AnalyticsDashboard 
        userRole={'staff' as Role}
        tenantId={tenantId}
        userId={staffId || ""} // Use staffId as userId fallback
      />
    </div>
  );
}