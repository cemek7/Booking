'use client';

import React from 'react';
import { UserRole, RoleAnalyticsData } from '@/src/types/analytics';
import { getUnifiedAnalyticsAccess, validateAnalyticsRequest } from '@/lib/unified-analytics-permissions';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';
import Phase5Dashboard from '@/components/Phase5Dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Lock } from 'lucide-react';

interface RoleBasedAnalyticsProps {
  tenantId: string;
  userRole: UserRole;
  userId?: string;
  analyticsData?: RoleAnalyticsData;
  className?: string;
}

export default function RoleBasedAnalytics({ 
  tenantId, 
  userRole, 
  userId,
  analyticsData,
  className 
}: RoleBasedAnalyticsProps) {
  // Use unified analytics access system
  const analyticsAccess = getUnifiedAnalyticsAccess(userRole);
  
  // Validate access for tenant analytics
  const tenantValidation = validateAnalyticsRequest(userRole, 'tenant', tenantId, userId);

  // No analytics access
  if (!analyticsAccess.canAccess || !tenantValidation.allowed) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-muted-foreground" />
            Analytics Access Restricted
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <Lock className="h-4 w-4" />
            <AlertDescription>
              {tenantValidation.reason || 'You don\'t have permission to view analytics. Contact your administrator for access.'}
            </AlertDescription>
          </Alert>
          {analyticsAccess.restrictions.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-muted-foreground mb-2">Restrictions:</p>
              <ul className="text-sm space-y-1">
                {analyticsAccess.restrictions.map((restriction, idx) => (
                  <li key={idx} className="text-red-600">• {restriction}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // System-level analytics (superadmin)
  if (analyticsAccess.level === 'system') {
    return (
      <div className={className}>
        <div className="mb-4 flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            System Administrator Analytics
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {analyticsAccess.availableViews.length} views available
          </Badge>
        </div>
        <Phase5Dashboard tenantId={tenantId} userRole={userRole} />
      </div>
    );
  }

  // Full analytics access (owner)
  if (analyticsAccess.level === 'full') {
    return (
      <div className={className}>
        <div className="mb-4 flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Full Analytics Access
          </Badge>
          <Badge variant="secondary" className="text-xs capitalize">
            {userRole}
          </Badge>
          <Badge variant="outline" className="text-xs text-green-600">
            {analyticsAccess.availableViews.length} views
          </Badge>
        </div>
        <AnalyticsDashboard 
          tenantId={tenantId} 
          userRole={userRole}
          showFullMetrics={true}
          showStaffPerformance={analyticsAccess.permissions.canViewTeamData}
          showRevenueTrends={analyticsAccess.permissions.canViewTenantData}
          showAdvancedFeatures={analyticsAccess.permissions.canCreateDashboards}
        />
      </div>
    );
  }

  // Operational analytics (manager)
  if (analyticsAccess.level === 'operational') {
    return (
      <div className={className}>
        <div className="mb-4 flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Operational Analytics
          </Badge>
          <Badge variant="secondary" className="text-xs capitalize">
            {userRole}
          </Badge>
          <Badge variant="outline" className="text-xs">
            Team scope
          </Badge>
        </div>
        <AnalyticsDashboard 
          tenantId={tenantId} 
          userRole={userRole}
          showFullMetrics={false}
          showStaffPerformance={analyticsAccess.permissions.canViewTeamData}
          showRevenueTrends={false}
          showAdvancedFeatures={false}
          restrictedView="operational"
        />
      </div>
    );
  }

  // Basic analytics (staff)
  if (analyticsAccess.level === 'basic') {
    return (
      <div className={className}>
        <div className="mb-4 flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Personal Analytics
          </Badge>
          <Badge variant="secondary" className="text-xs capitalize">
            {userRole}
          </Badge>
          <Badge variant="outline" className="text-xs">
            Personal scope only
          </Badge>
        </div>
        <AnalyticsDashboard 
          tenantId={tenantId} 
          userRole={userRole}
          showFullMetrics={false}
          showStaffPerformance={false}
          showRevenueTrends={false}
          showAdvancedFeatures={false}
          restrictedView="personal"
        />
      </div>
    );
  }

  return null;
}