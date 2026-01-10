/**
 * Role Type Definitions
 * 
 * Comprehensive type definitions for user roles, permissions, and 
 * role-based component properties across the booking system.
 */

// Base role enumeration - STANDARDIZED
export type Role = 'staff' | 'manager' | 'owner' | 'superadmin';
export type UserRole = Role; // Alias for compatibility

// Legacy role mapping for backward compatibility
export type LegacyRoleMapping = {
  'admin': 'superadmin';
  'tenant_admin': 'owner';
  'receptionist': 'staff';
};

// Function to normalize legacy roles to standard roles
export function normalizeRole(role: string): Role {
  const legacyMap: Record<string, Role> = {
    'admin': 'superadmin',
    'tenant_admin': 'owner',
    'receptionist': 'staff'
  };
  
  const normalized = legacyMap[role] || role;
  if (!isValidRole(normalized)) {
    throw new Error(`Invalid role: ${role}`);
  }
  return normalized as Role;
}

// Role validation function
export function isValidRole(role: string): role is Role {
  return ['staff', 'manager', 'owner', 'superadmin'].includes(role);
}

// Role hierarchy for permission inheritance - FIXED
// Role hierarchy levels (0=highest, 3=lowest)
export const ROLE_LEVELS: Record<Role, number> = {
  superadmin: 0,  // Platform admin
  owner: 1,       // Tenant admin
  manager: 2,     // Operations lead
  staff: 3        // Base worker
} as const;

// Get role hierarchy level
export function getRoleLevel(role: Role): number {
  return ROLE_LEVELS[role] ?? 999;
}

// Check if user role can inherit permissions from target role
export function canInheritRole(userRole: Role, targetRole: Role): boolean {
  return getRoleLevel(userRole) <= getRoleLevel(targetRole);
}

// Database schema alignment types
export interface TenantUser {
  id: string;
  tenant_id: string;
  user_id: string;
  role: Role;
  email?: string;
  name?: string;
  staff_type?: string;
  status: 'active' | 'on_leave';
  created_at: string;
}

export interface RoleHierarchyStats {
  tenant_id: string;
  superadmin_count: number;
  owner_count: number;
  manager_count: number;
  staff_count: number;
  total_users: number;
  last_user_added: string;
}

export interface SchemaValidationIssue {
  table_name: string;
  issue_type: string;
  issue_description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface RoleHierarchy {
  superadmin: {
    level: 0;
    inherits: ['owner', 'manager', 'staff'];
    permissions: 'all';
  };
  owner: {
    level: 1;
    inherits: ['manager', 'staff'];
    permissions: 'tenant-admin';
  };
  manager: {
    level: 2;
    inherits: ['staff'];
    permissions: 'operational-management';
  };
  staff: {
    level: 3;
    inherits: [];
    permissions: 'basic-operations';
  };
}

// Get roles that a given role inherits from
export function getInheritedRoles(role: Role): Role[] {
  const hierarchy: Record<Role, Role[]> = {
    superadmin: ['owner', 'manager', 'staff'],
    owner: ['manager', 'staff'],
    manager: ['staff'],
    staff: []
  };
  return hierarchy[role] || [];
}

// User type with role information
export interface UserWithRole {
  id: string;
  email: string;
  full_name?: string;
  role: Role; // Using standardized Role type
  tenant_id?: string;
  permissions?: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Role-specific data access patterns
export interface RoleDataAccess {
  role: Role; // Using standardized Role type
  canAccessTenantData: boolean;
  canAccessAllTenants: boolean;
  canModifyUsers: boolean;
  canViewAnalytics: boolean;
  canManageBookings: boolean;
  canAccessBilling: boolean;
  canManageSettings: boolean;
  analyticsScope: 'none' | 'personal' | 'team' | 'tenant' | 'global';
}

// Component prop types for role-based rendering
export interface RoleBasedProps {
  userRole: Role; // Using standardized Role type
  tenantId?: string;
  userId?: string;
  allowedRoles?: Role[];
  fallbackComponent?: React.ComponentType;
}

// Dashboard-specific role types
export interface DashboardRoleConfig {
  role: Role; // Using standardized Role type
  dashboardPath: string;
  displayName: string;
  description: string;
  availableModules: DashboardModule[];
  defaultModule: string;
}

export interface DashboardModule {
  id: string;
  name: string;
  path: string;
  requiredPermissions: string[];
  icon?: string;
  description?: string;
}

// Navigation types for role-based menus
export interface RoleNavigationItem {
  id: string;
  label: string;
  path: string;
  icon?: string;
  requiredRoles: Role[]; // Using standardized Role type
  requiredPermissions?: string[];
  children?: RoleNavigationItem[];
  isExternal?: boolean;
}

// Role-based component visibility
export interface RoleVisibility {
  superadmin: {
    canSee: 'everything';
    restrictions: [];
  };
  owner: {
    canSee: 'tenant-scoped';
    restrictions: ['system-settings', 'global-analytics'];
  };
  manager: {
    canSee: 'operational';
    restrictions: ['billing', 'tenant-settings', 'user-management'];
  };
  staff: {
    canSee: 'limited';
    restrictions: ['analytics', 'settings', 'user-management', 'billing'];
  };
}

// Permission-based feature flags
export interface RoleFeatureAccess {
  role: Role; // Using standardized Role type
  features: {
    analytics: boolean;
    userManagement: boolean;
    billing: boolean;
    settings: boolean;
    messaging: boolean;
    reporting: boolean;
    apiAccess: boolean;
    webhooks: boolean;
  };
}

// Role-based data filtering
export interface RoleDataFilter {
  role: Role; // Using standardized Role type
  tenantFilter: boolean;
  userFilter: boolean;
  dateRangeRestriction?: {
    maxDays: number;
    allowFuture: boolean;
  };
  dataFields: {
    allowPersonalData: boolean;
    allowFinancialData: boolean;
    allowSystemData: boolean;
  };
}

// Type guards for role checking
export function isRole(role: string): role is Role {
  return ['staff', 'manager', 'owner', 'superadmin'].includes(role);
}

export function isSuperAdmin(user: UserWithRole): boolean {
  return user.role === 'superadmin';
}

export function isOwner(user: UserWithRole): boolean {
  return user.role === 'owner';
}

export function isManager(user: UserWithRole): boolean {
  return user.role === 'manager';
}

export function isStaff(user: UserWithRole): boolean {
  return user.role === 'staff';
}

export function hasRoleAccess(userRole: Role, requiredRoles: Role[]): boolean {
  // Check direct role match
  if (requiredRoles.includes(userRole)) return true;
  
  // Check inherited roles
  const inheritedRoles = getInheritedRoles(userRole);
  return requiredRoles.some(required => inheritedRoles.includes(required));
}

export function canAccessRole(userRole: Role, targetRole: Role): boolean {
  const hierarchy: Record<Role, number> = {
    staff: 0,
    manager: 1,
    owner: 2,
    superadmin: 3
  };
  
  return hierarchy[userRole] >= hierarchy[targetRole];
}

// Check if a role can perform actions of another role (inheritance check)
export function canAssumeRole(userRole: Role, targetRole: Role): boolean {
  if (userRole === targetRole) return true;
  return getInheritedRoles(userRole).includes(targetRole);
}

// Role-specific configuration constants
export const ROLE_CONFIGS: Record<Role, DashboardRoleConfig> = {
  superadmin: {
    role: 'superadmin',
    dashboardPath: '/superadmin',
    displayName: 'Super Administrator',
    description: 'Full system access and global management',
    availableModules: [
      { id: 'overview', name: 'Overview', path: '/', requiredPermissions: [] },
      { id: 'tenants', name: 'Tenants', path: '/tenants', requiredPermissions: ['manage:tenants'] },
      { id: 'analytics', name: 'Analytics', path: '/analytics', requiredPermissions: ['view:global-analytics'] },
      { id: 'settings', name: 'Settings', path: '/settings', requiredPermissions: ['manage:system'] }
    ],
    defaultModule: 'overview'
  },
  owner: {
    role: 'owner',
    dashboardPath: '/dashboard/owner',
    displayName: 'Business Owner',
    description: 'Full tenant access and business management',
    availableModules: [
      { id: 'overview', name: 'Overview', path: '/', requiredPermissions: [] },
      { id: 'analytics', name: 'Analytics', path: '/analytics', requiredPermissions: ['view:analytics'] },
      { id: 'bookings', name: 'Bookings', path: '/bookings', requiredPermissions: ['view:bookings'] },
      { id: 'staff', name: 'Staff', path: '/staff', requiredPermissions: ['manage:staff'] },
      { id: 'settings', name: 'Settings', path: '/settings', requiredPermissions: ['manage:tenant'] }
    ],
    defaultModule: 'overview'
  },
  manager: {
    role: 'manager',
    dashboardPath: '/dashboard/manager',
    displayName: 'Manager',
    description: 'Operational management and team coordination',
    availableModules: [
      { id: 'overview', name: 'Overview', path: '/', requiredPermissions: [] },
      { id: 'analytics', name: 'Analytics', path: '/analytics', requiredPermissions: ['view:analytics'] },
      { id: 'bookings', name: 'Bookings', path: '/bookings', requiredPermissions: ['view:bookings'] },
      { id: 'schedule', name: 'Schedule', path: '/schedule', requiredPermissions: ['view:schedule'] },
      { id: 'staff', name: 'Staff', path: '/staff', requiredPermissions: ['view:staff'] }
    ],
    defaultModule: 'overview'
  },
  staff: {
    role: 'staff',
    dashboardPath: '/dashboard/staff-dashboard',
    displayName: 'Staff Member',
    description: 'Personal schedule and task management',
    availableModules: [
      { id: 'overview', name: 'Overview', path: '/', requiredPermissions: [] },
      { id: 'schedule', name: 'My Schedule', path: '/schedule', requiredPermissions: ['view:own-schedule'] },
      { id: 'tasks', name: 'Tasks', path: '/tasks', requiredPermissions: ['view:own-tasks'] },
      { id: 'profile', name: 'Profile', path: '/profile', requiredPermissions: ['edit:own-profile'] }
    ],
    defaultModule: 'overview'
  }
};