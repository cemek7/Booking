/**
 * CONSOLIDATED TYPE DEFINITIONS - PHASE 1 TYPE CONSOLIDATION
 * 
 * This is the canonical source for all core type definitions across the Boka system.
 * All domain-specific types import from this file to ensure consistency.
 * 
 * CONSOLIDATION NOTES:
 * - Role type: Canonical definition (staff | manager | owner | superadmin)
 * - Permission types: Unified from permissions.ts and enhanced-permissions.ts
 * - Auth types: Consolidated from unified-auth.ts and enhanced-auth-types.ts
 * - User types: Merged and standardized
 * 
 * IMPORTS: Replace all scattered imports with "from '@/types'"
 * Example: import { Role, UnifiedUser } from '@/types'
 */

// ============================================================================
// CORE ROLE TYPES (CANONICAL)
// ============================================================================

/**
 * Standard role type used throughout the system.
 * Single source of truth - replaces all duplicated Role definitions
 */
export type Role = 'staff' | 'manager' | 'owner' | 'superadmin';

/**
 * Alias for backward compatibility
 */
export type UserRole = Role;

/**
 * Role level in hierarchy (0=highest, 3=lowest)
 */
export const ROLE_LEVELS: Record<Role, number> = {
  superadmin: 0,  // Platform admin - full system access
  owner: 1,       // Tenant admin - tenant-scoped access
  manager: 2,     // Operations lead - team-scoped access
  staff: 3        // Base worker - personal access
} as const;

/**
 * Get hierarchy level for a role
 */
export function getRoleLevel(role: Role): number {
  return ROLE_LEVELS[role] ?? 999;
}

/**
 * Check if a role is valid
 */
export function isValidRole(role: string): role is Role {
  return ['staff', 'manager', 'owner', 'superadmin'].includes(role);
}

/**
 * Normalize legacy role names to standard roles
 */
export function normalizeRole(role: string): Role {
  const legacyMap: Record<string, Role> = {
    'admin': 'superadmin',
    'tenant_admin': 'owner',
    'receptionist': 'staff',
    'employee': 'staff'
  };
  
  const normalized = legacyMap[role] || role;
  if (!isValidRole(normalized)) {
    throw new Error(`Invalid role: ${role}`);
  }
  return normalized as Role;
}

/**
 * Check if one role can inherit from another
 */
export function canInheritRole(userRole: Role, targetRole: Role): boolean {
  return getRoleLevel(userRole) <= getRoleLevel(targetRole);
}

/**
 * Get all roles that inherit from a given role
 */
export function getInheritedRoles(role: Role): Role[] {
  const hierarchy: Record<Role, Role[]> = {
    superadmin: ['owner', 'manager', 'staff'],
    owner: ['manager', 'staff'],
    manager: ['staff'],
    staff: []
  };
  return hierarchy[role] || [];
}

/**
 * Role hierarchy for visual representation
 */
export const ROLE_HIERARCHY = {
  superadmin: {
    level: 0,
    inherits: ['owner', 'manager', 'staff'],
    permissions: 'all'
  },
  owner: {
    level: 1,
    inherits: ['manager', 'staff'],
    permissions: 'tenant-admin'
  },
  manager: {
    level: 2,
    inherits: ['staff'],
    permissions: 'operational-management'
  },
  staff: {
    level: 3,
    inherits: [],
    permissions: 'basic-operations'
  }
} as const;

// ============================================================================
// PERMISSION TYPES (CONSOLIDATED)
// ============================================================================

/**
 * Permission categories for organization
 */
export type PermissionCategory = 
  | 'system'
  | 'tenant'
  | 'user'
  | 'booking'
  | 'analytics'
  | 'billing'
  | 'messaging'
  | 'reporting'
  | 'api';

/**
 * Permission actions
 */
export type PermissionAction = 
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'manage'
  | 'view'
  | 'execute';

/**
 * Permission scope (determines who can execute)
 */
export type PermissionScope = 
  | 'global'      // Platform-wide
  | 'tenant'      // Tenant-scoped
  | 'team'        // Team-scoped
  | 'own'         // Self-only
  | 'none';       // No access

/**
 * Single permission definition
 */
export interface Permission {
  id: string;
  category: PermissionCategory;
  action: PermissionAction;
  scope: PermissionScope;
  description: string;
  resource?: string;
  conditions?: PermissionCondition[];
}

/**
 * Conditions for contextual permission access
 */
export interface PermissionCondition {
  type: 'time' | 'location' | 'data' | 'user' | 'tenant';
  operator: 'equals' | 'contains' | 'greater' | 'less' | 'in' | 'not_in';
  value: any;
  description: string;
}

/**
 * Permission restrictions on specific actions
 */
export interface PermissionRestriction {
  permissionId: string;
  restrictionType: 'time' | 'data' | 'feature' | 'rate';
  description: string;
  config: Record<string, any>;
}

/**
 * Role-to-permission mapping
 */
export interface RolePermissions {
  role: Role;
  permissions: Permission[];
  inheritedFrom?: Role[];
  restrictions?: PermissionRestriction[];
}

/**
 * Result of permission check
 */
export interface PermissionCheckResult {
  granted: boolean;
  permission?: Permission;
  reason?: string;
  restrictions?: PermissionRestriction[];
  context?: Record<string, any>;
}

/**
 * Role-specific permission mapping
 */
export const ROLE_PERMISSION_MAP: Record<Role, string[]> = {
  superadmin: [
    'system:manage:all',
    'tenant:create',
    'tenant:manage:all',
    'user:manage:all',
    'booking:manage:all',
    'analytics:view:global',
    'billing:manage:all',
    'messaging:send:whatsapp',
    'reporting:view:global',
    'api:manage:all'
  ],
  owner: [
    'tenant:manage:all',
    'user:manage:all',
    'booking:manage:all',
    'analytics:view:tenant',
    'billing:manage:all',
    'messaging:send:whatsapp',
    'reporting:view:tenant',
    'api:manage:own'
  ],
  manager: [
    'booking:manage:all',
    'user:view:profiles',
    'analytics:view:team',
    'booking:view:all',
    'messaging:send:whatsapp',
    'reporting:view:team'
  ],
  staff: [
    'booking:view:own',
    'booking:create',
    'user:view:own',
    'user:update:own',
    'analytics:view:own',
    'messaging:view:conversations'
  ]
};

// ============================================================================
// USER & AUTH TYPES (CONSOLIDATED)
// ============================================================================

/**
 * Unified user representation across the system
 */
export interface UnifiedUser {
  id: string;
  email: string;
  full_name?: string;
  role: Role;
  tenantId: string;
  isSuperAdmin: boolean;
  permissions: string[];
  effectivePermissions: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, any>;
}

/**
 * User with role information (for database queries)
 */
export interface UserWithRole {
  id: string;
  email: string;
  full_name?: string;
  role: Role;
  tenant_id?: string;
  permissions?: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Tenant user (database schema type)
 */
export interface TenantUser {
  id: string;
  tenant_id: string;
  user_id: string;
  role: Role;
  email?: string;
  name?: string;
  staff_type?: string;
  status: 'active' | 'on_leave' | 'inactive';
  created_at: string;
  updated_at?: string;
}

/**
 * Role-based data access configuration
 */
export interface RoleDataAccess {
  role: Role;
  canAccessTenantData: boolean;
  canAccessAllTenants: boolean;
  canModifyUsers: boolean;
  canViewAnalytics: boolean;
  canManageBookings: boolean;
  canAccessBilling: boolean;
  canManageSettings: boolean;
  analyticsScope: 'none' | 'personal' | 'team' | 'tenant' | 'global';
}

/**
 * Role feature access matrix
 */
export interface RoleFeatureAccess {
  role: Role;
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

/**
 * Authentication result
 */
export interface AuthResult {
  success: boolean;
  user: UnifiedUser | null;
  error?: string;
  statusCode?: number;
}

/**
 * Authentication options
 */
export interface AuthOptions {
  requiredPermissions?: string[];
  requiredRoles?: Role[];
  allowSuperAdmin?: boolean;
  requireTenantAccess?: boolean;
  context?: Record<string, any>;
}

/**
 * Session information
 */
export interface UserSession {
  id: string;
  session_token: string;
  user_id: string;
  tenant_id?: string;
  ip_address?: string;
  user_agent?: string;
  device_fingerprint?: string;
  is_active: boolean;
  last_activity: Date;
  expires_at: Date;
  metadata?: Record<string, any>;
}

/**
 * MFA configuration
 */
export interface MFAConfig {
  id: string;
  user_id: string;
  method: 'totp' | 'sms' | 'email' | 'backup_codes';
  is_primary: boolean;
  is_enabled: boolean;
  verified_at?: Date;
  last_used_at?: Date;
  failure_count: number;
  blocked_until?: Date;
}

/**
 * Authentication event tracking
 */
export interface AuthenticationEvent {
  user_id: string;
  event_type: 'login' | 'logout' | 'login_failed' | 'password_change' | 'mfa_setup' | 'mfa_verify' | 'mfa_failed' | 'session_timeout' | 'forced_logout' | 'password_reset';
  ip_address?: string;
  user_agent?: string;
  session_id?: string;
  success: boolean;
  failure_reason?: string;
  metadata?: Record<string, any>;
  created_at?: Date;
}

/**
 * Security metrics for user
 */
export interface SecurityMetrics {
  login_count: number;
  failed_login_count: number;
  unique_ips: number;
  unique_devices: number;
  mfa_verifications: number;
  password_changes: number;
  lockout_events: number;
  last_login?: Date;
  suspicious_activity_score: 'low' | 'medium' | 'high';
}

// ============================================================================
// UNIFIED PERMISSION CONTEXT
// ============================================================================

/**
 * Context for permission evaluation
 */
export interface UnifiedPermissionContext {
  userId?: string;
  tenantId?: string;
  targetUserId?: string;
  targetTenantId?: string;
  resourceOwnerId?: string;
  teamId?: string;
  operationType?: 'read' | 'write' | 'delete' | 'manage';
  resourceType?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  [key: string]: any;
}

/**
 * Result of unified access check
 */
export interface UnifiedAccessResult {
  granted: boolean;
  user?: UnifiedUser;
  reason?: string;
  appliedRules: string[];
  securityLevel: 'low' | 'medium' | 'high' | 'critical';
  auditRequired: boolean;
}

// ============================================================================
// ROLE-BASED COMPONENT TYPES
// ============================================================================

/**
 * Props for components that need role checking
 */
export interface RoleBasedProps {
  userRole: Role;
  tenantId?: string;
  userId?: string;
  allowedRoles?: Role[];
  fallbackComponent?: React.ComponentType;
}

/**
 * Dashboard configuration per role
 */
export interface DashboardRoleConfig {
  role: Role;
  dashboardPath: string;
  displayName: string;
  description: string;
  availableModules: DashboardModule[];
  defaultModule: string;
}

/**
 * Dashboard module definition
 */
export interface DashboardModule {
  id: string;
  name: string;
  path: string;
  requiredPermissions: string[];
  icon?: string;
  description?: string;
}

/**
 * Navigation item for role-based menus
 */
export interface RoleNavigationItem {
  id: string;
  label: string;
  path: string;
  icon?: string;
  requiredRoles: Role[];
  requiredPermissions?: string[];
  children?: RoleNavigationItem[];
  isExternal?: boolean;
}

/**
 * Role visibility matrix
 */
export const ROLE_VISIBILITY = {
  superadmin: {
    canSee: 'everything',
    restrictions: []
  },
  owner: {
    canSee: 'tenant-scoped',
    restrictions: ['system-settings', 'global-analytics']
  },
  manager: {
    canSee: 'operational',
    restrictions: ['billing', 'tenant-settings', 'user-management']
  },
  staff: {
    canSee: 'limited',
    restrictions: ['analytics', 'settings', 'user-management', 'billing']
  }
} as const;

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if value is a valid Role
 */
export function isRole(value: any): value is Role {
  return ['staff', 'manager', 'owner', 'superadmin'].includes(value);
}

/**
 * Check if user is superadmin
 */
export function isSuperAdmin(user: UnifiedUser | UserWithRole): boolean {
  return user.role === 'superadmin';
}

/**
 * Check if user is owner
 */
export function isOwner(user: UnifiedUser | UserWithRole): boolean {
  return user.role === 'owner';
}

/**
 * Check if user is manager
 */
export function isManager(user: UnifiedUser | UserWithRole): boolean {
  return user.role === 'manager';
}

/**
 * Check if user is staff
 */
export function isStaff(user: UnifiedUser | UserWithRole): boolean {
  return user.role === 'staff';
}

/**
 * Get display name for role
 */
export function getRoleDisplayName(role: Role): string {
  const names: Record<Role, string> = {
    superadmin: 'Super Admin',
    owner: 'Owner',
    manager: 'Manager',
    staff: 'Staff'
  };
  return names[role] ?? 'Unknown';
}

// ============================================================================
// CANONICAL AUTHENTICATION TYPES
// ============================================================================
// 
// All authentication-related types consolidated in src/types/auth.ts
// This provides a single source of truth for:
// - UnifiedAuthContext, AuthSession, MFAConfig, APIKey, AuditLogEntry
// - AuthenticationEvent, UserSession, SecurityMetrics
// - AuthContext, LoginData, LoginResult, AuthenticatedUser
// 
// PHASE 2B: Type consolidation completed
// Reduces: 7 scattered type files → 1 canonical auth.ts

export * from './auth';

// ============================================================================
// EXPORT INDEX FOR CONVENIENCE
// ============================================================================

export * from './supabase';
export * from './publicBooking';
export * from './shared';
