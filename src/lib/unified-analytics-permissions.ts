/**
 * Unified Analytics Permissions
 * 
 * Consolidates multiple analytics permission checking methods into a single,
 * comprehensive system using enhanced RBAC and role inheritance.
 */

import { Role } from '@/types';
import { getAnalyticsLevel } from '@/types/unified-permissions';
import type { AnalyticsPermissions } from '@/types/analytics';

export interface UnifiedAnalyticsAccess {
  canAccess: boolean;
  level: 'none' | 'basic' | 'operational' | 'full' | 'system';
  permissions: AnalyticsPermissions;
  availableViews: AnalyticsView[];
  restrictions: string[];
}

export interface AnalyticsView {
  id: string;
  name: string;
  description: string;
  requiredPermissions: string[];
  scope: 'personal' | 'team' | 'tenant' | 'global';
}

// Define available analytics views
export const ANALYTICS_VIEWS: Record<string, AnalyticsView> = {
  personal: {
    id: 'personal',
    name: 'Personal Analytics',
    description: 'View your personal performance metrics',
    requiredPermissions: ['analytics:view:own'],
    scope: 'personal'
  },
  team: {
    id: 'team',
    name: 'Team Analytics',
    description: 'View team performance and operational metrics',
    requiredPermissions: ['analytics:view:team'],
    scope: 'team'
  },
  tenant: {
    id: 'tenant',
    name: 'Business Analytics',
    description: 'View complete tenant business analytics',
    requiredPermissions: ['analytics:view:tenant'],
    scope: 'tenant'
  },
  global: {
    id: 'global',
    name: 'Global Analytics',
    description: 'View system-wide analytics across all tenants',
    requiredPermissions: ['analytics:view:global'],
    scope: 'global'
  },
  financial: {
    id: 'financial',
    name: 'Financial Analytics',
    description: 'View revenue, billing, and financial metrics',
    requiredPermissions: ['analytics:view:tenant', 'billing:view:invoices'],
    scope: 'tenant'
  },
  staffManagement: {
    id: 'staffManagement',
    name: 'Staff Performance Analytics',
    description: 'View detailed staff performance and utilization',
    requiredPermissions: ['analytics:view:team', 'user:view:profiles'],
    scope: 'team'
  }
};

/**
 * Get unified analytics access information for a user role
 */
export function getUnifiedAnalyticsAccess(userRole: Role): UnifiedAnalyticsAccess {
  const level = getAnalyticsLevel(userRole);
  
  // Determine available views based on role
  const availableViews: AnalyticsView[] = [];
  const restrictions: string[] = [];
  
  Object.values(ANALYTICS_VIEWS).forEach(view => {
    // Simple role-based view access
    const canAccess = (userRole === 'owner' || userRole === 'manager' || userRole === 'staff');
    
    if (canAccess) {
      availableViews.push(view);
    } else {
      restrictions.push(`Cannot access ${view.name.toLowerCase()}`);
    }
  });
  
  // Build unified permissions object based on role level
  const permissions: AnalyticsPermissions = {
    canViewGlobalData: userRole === 'owner' || userRole === 'superadmin',
    canViewTenantData: userRole === 'owner' || userRole === 'manager',
    canViewTeamData: userRole === 'manager' || userRole === 'owner',
    canViewPersonalData: userRole === 'staff' || userRole === 'manager' || userRole === 'owner',
    canExportData: userRole === 'owner' || userRole === 'manager',
    canCreateDashboards: userRole === 'owner',
    canShareDashboards: userRole === 'owner' || userRole === 'manager',
    dataRetentionDays: getDataRetentionForRole(userRole)
  };
  
  return {
    canAccess: level !== 'none',
    level: level === 'global' ? 'full' : level === 'tenant' ? 'operational' : level === 'team' ? 'basic' : level === 'personal' ? 'basic' : 'none',
    permissions,
    availableViews,
    restrictions
  };
}

/**
 * Check if a user can access a specific analytics view
 */
export function canAccessAnalyticsView(userRole: Role, viewId: string): boolean {
  const view = ANALYTICS_VIEWS[viewId];
  if (!view) return false;
  
  // Simple role-based access
  return userRole === 'owner' || userRole === 'manager' || (userRole === 'staff' && viewId.includes('personal'));
}

/**
 * Get data retention period for a role
 */
function getDataRetentionForRole(role: Role): number {
  switch (role) {
    case 'superadmin':
      return -1; // Unlimited
    case 'owner':
      return 365; // 1 year
    case 'manager':
      return 180; // 6 months
    case 'staff':
      return 90;  // 3 months
    default:
      return 90;
  }
}

/**
 * Get analytics scope restriction for a role
 */
export function getAnalyticsScope(userRole: Role): 'none' | 'personal' | 'team' | 'tenant' | 'global' {
  switch (userRole) {
    case 'superadmin':
      return 'global';
    case 'owner':
      return 'global';
    case 'manager':
      return 'team';
    case 'staff':
      return 'personal';
    default:
      return 'none';
  }
}

/**
 * Validate analytics request with proper authorization
 */
export function validateAnalyticsRequest(
  userRole: Role, 
  requestedScope: 'personal' | 'team' | 'tenant' | 'global',
  tenantId?: string,
  userId?: string
): { allowed: boolean; reason?: string } {
  const access = getUnifiedAnalyticsAccess(userRole);
  
  if (!access.canAccess) {
    return { allowed: false, reason: 'No analytics access permissions' };
  }
  
  switch (requestedScope) {
    case 'global':
      if (!access.permissions.canViewGlobalData) {
        return { allowed: false, reason: 'Global analytics access denied' };
      }
      break;
      
    case 'tenant':
      if (!access.permissions.canViewTenantData) {
        return { allowed: false, reason: 'Tenant analytics access denied' };
      }
      if (!tenantId) {
        return { allowed: false, reason: 'Tenant ID required for tenant analytics' };
      }
      break;
      
    case 'team':
      if (!access.permissions.canViewTeamData) {
        return { allowed: false, reason: 'Team analytics access denied' };
      }
      if (!tenantId) {
        return { allowed: false, reason: 'Tenant ID required for team analytics' };
      }
      break;
      
    case 'personal':
      if (!access.permissions.canViewPersonalData) {
        return { allowed: false, reason: 'Personal analytics access denied' };
      }
      if (!userId) {
        return { allowed: false, reason: 'User ID required for personal analytics' };
      }
      break;
  }
  
  return { allowed: true };
}

/**
 * Get analytics menu items based on user permissions
 */
export function getAnalyticsMenuItems(userRole: Role): Array<{
  id: string;
  label: string;
  path: string;
  description: string;
  enabled: boolean;
}> {
  const access = getUnifiedAnalyticsAccess(userRole);
  
  const menuItems = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      path: '/dashboard/analytics',
      description: 'Overview analytics dashboard',
      enabled: access.canAccess
    },
    {
      id: 'personal',
      label: 'My Performance',
      path: '/dashboard/analytics/personal',
      description: 'Your personal performance metrics',
      enabled: access.permissions.canViewPersonalData
    },
    {
      id: 'team',
      label: 'Team Analytics',
      path: '/dashboard/analytics/team',
      description: 'Team performance and metrics',
      enabled: access.permissions.canViewTeamData
    },
    {
      id: 'business',
      label: 'Business Analytics',
      path: '/dashboard/analytics/business',
      description: 'Complete business analytics',
      enabled: access.permissions.canViewTenantData
    },
    {
      id: 'financial',
      label: 'Financial Reports',
      path: '/dashboard/analytics/financial',
      description: 'Revenue and financial analytics',
      enabled: canAccessAnalyticsView(userRole, 'financial')
    },
    {
      id: 'global',
      label: 'Global Analytics',
      path: '/superadmin/analytics',
      description: 'System-wide analytics',
      enabled: access.permissions.canViewGlobalData
    }
  ];
  
  return menuItems.filter(item => item.enabled);
}

// Export types
export type { AnalyticsPermissions } from '@/types/analytics';