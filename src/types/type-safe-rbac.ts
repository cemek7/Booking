/**
 * Type Safety Enhancement for Role-Based Access Control
 * Provides compile-time safety for permission checks and role validation
 */

import { Role, ROLE_LEVELS, getRoleLevel, canInheritRole } from './roles';

// ===========================================
// TYPE GUARDS AND VALIDATORS
// ===========================================

/**
 * Type guard to check if a value is a valid Role
 */
export function isValidRole(value: unknown): value is Role {
  return typeof value === 'string' && 
         value in ROLE_LEVELS &&
         ['staff', 'manager', 'owner', 'superadmin'].includes(value);
}

/**
 * Type guard to check if a value is a valid role array
 */
export function isValidRoleArray(value: unknown): value is Role[] {
  return Array.isArray(value) && value.every(isValidRole);
}

/**
 * Type assertion function for safe role casting
 */
export function assertRole(value: unknown, context?: string): Role {
  if (!isValidRole(value)) {
    throw new TypeError(`Invalid role${context ? ` in ${context}` : ''}: ${value}. Expected one of: staff, manager, owner, superadmin`);
  }
  return value;
}

/**
 * Type assertion function for safe role array casting
 */
export function assertRoleArray(value: unknown, context?: string): Role[] {
  if (!isValidRoleArray(value)) {
    throw new TypeError(`Invalid role array${context ? ` in ${context}` : ''}: ${value}`);
  }
  return value;
}

// ===========================================
// STRICT TYPE INTERFACES
// ===========================================

/**
 * Strict user interface with compile-time role validation
 */
export interface StrictUserWithRole {
  readonly id: string;
  readonly email: string;
  readonly role: Role; // Only valid Role types allowed
  readonly tenant_id?: string;
  readonly full_name?: string;
  readonly is_active: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Strict tenant user interface aligned with database schema
 */
export interface StrictTenantUser {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly role: Role; // Strictly typed
  readonly email?: string;
  readonly name?: string;
  readonly staff_type?: string;
  readonly status: 'active' | 'on_leave'; // Literal types only
  readonly created_at: string;
}

/**
 * Strict permission check result with detailed typing
 */
export interface StrictPermissionResult<TContext = unknown> {
  readonly granted: boolean;
  readonly role: Role;
  readonly reason: string;
  readonly context: TContext;
  readonly timestamp: string;
}

/**
 * Strict role hierarchy context
 */
export interface StrictRoleHierarchyContext {
  readonly userRole: Role;
  readonly requiredRole: Role;
  readonly canInherit: boolean;
  readonly hierarchyLevel: number;
  readonly requiredLevel: number;
}

// ===========================================
// PERMISSION CHECKER WITH TYPE SAFETY
// ===========================================

/**
 * Type-safe permission checker class
 */
export class TypeSafePermissionChecker {
  /**
   * Check if user role can access a required role level
   */
  static canAccessRole(userRole: Role, requiredRole: Role): StrictPermissionResult<StrictRoleHierarchyContext> {
    const userLevel = getRoleLevel(userRole);
    const requiredLevel = getRoleLevel(requiredRole);
    const canAccess = canInheritRole(userRole, requiredRole);
    
    return {
      granted: canAccess,
      role: userRole,
      reason: canAccess 
        ? `Role ${userRole} (level ${userLevel}) can inherit from ${requiredRole} (level ${requiredLevel})`
        : `Role ${userRole} (level ${userLevel}) cannot inherit from ${requiredRole} (level ${requiredLevel})`,
      context: {
        userRole,
        requiredRole,
        canInherit: canAccess,
        hierarchyLevel: userLevel,
        requiredLevel
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Check if user can access any of the required roles
   */
  static canAccessAnyRole(userRole: Role, requiredRoles: readonly Role[]): StrictPermissionResult<Role[]> {
    const validRequiredRoles = requiredRoles.filter(isValidRole);
    const canAccess = validRequiredRoles.some(role => canInheritRole(userRole, role));
    
    return {
      granted: canAccess,
      role: userRole,
      reason: canAccess
        ? `Role ${userRole} can access one of: ${validRequiredRoles.join(', ')}`
        : `Role ${userRole} cannot access any of: ${validRequiredRoles.join(', ')}`,
      context: validRequiredRoles,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Validate role transition (for role updates)
   */
  static validateRoleTransition(fromRole: Role, toRole: Role, actorRole: Role): StrictPermissionResult<{
    fromRole: Role;
    toRole: Role;
    actorRole: Role;
  }> {
    const actorLevel = getRoleLevel(actorRole);
    const fromLevel = getRoleLevel(fromRole);
    const toLevel = getRoleLevel(toRole);
    
    // Actor must have higher privileges than both from and to roles
    const canModify = actorLevel < Math.min(fromLevel, toLevel);
    
    return {
      granted: canModify,
      role: actorRole,
      reason: canModify
        ? `Role ${actorRole} can modify ${fromRole} → ${toRole}`
        : `Role ${actorRole} insufficient privileges to modify ${fromRole} → ${toRole}`,
      context: { fromRole, toRole, actorRole },
      timestamp: new Date().toISOString()
    };
  }
}

// ===========================================
// UTILITY TYPES FOR API RESPONSES
// ===========================================

/**
 * Generic API response with role context
 */
export interface RoleAwareApiResponse<TData = unknown> {
  success: boolean;
  data?: TData;
  error?: string;
  role_context: {
    user_role: Role;
    required_role?: Role;
    tenant_id?: string;
    permissions_granted: boolean;
  };
  timestamp: string;
}

/**
 * Type-safe middleware context
 */
export interface TypeSafeMiddlewareContext {
  readonly user: StrictUserWithRole;
  readonly tenant?: {
    readonly id: string;
    readonly name: string;
  };
  readonly permissions: StrictPermissionResult;
  readonly request_id: string;
}

// ===========================================
// BRANDED TYPES FOR COMPILE-TIME SAFETY
// ===========================================

/**
 * Branded type for validated role strings
 */
export type ValidatedRole = Role & { readonly __brand: 'ValidatedRole' };

/**
 * Create a validated role with compile-time guarantees
 */
export function createValidatedRole(role: unknown): ValidatedRole {
  const validRole = assertRole(role, 'createValidatedRole');
  return validRole as ValidatedRole;
}

/**
 * Branded type for secure user IDs
 */
export type SecureUserId = string & { readonly __brand: 'SecureUserId' };

/**
 * Branded type for secure tenant IDs
 */
export type SecureTenantId = string & { readonly __brand: 'SecureTenantId' };

// ===========================================
// COMPILE-TIME ROLE VALIDATION
// ===========================================

/**
 * Template literal type for role validation
 */
export type RoleString = 'staff' | 'manager' | 'owner' | 'superadmin';

/**
 * Ensure compile-time role checking
 */
export type EnsureRole<T> = T extends Role ? T : never;

/**
 * Helper type to extract valid roles from union types
 */
export type ExtractValidRoles<T> = T extends Role ? T : never;

// ===========================================
// FUNCTION OVERLOADS FOR TYPE SAFETY
// ===========================================

/**
 * Type-safe function overloads for role checking
 */
export interface TypeSafeRoleChecker {
  // Single role check
  hasRole(user: StrictUserWithRole, role: Role): boolean;
  // Multiple role check  
  hasAnyRole(user: StrictUserWithRole, roles: readonly Role[]): boolean;
  // Role inheritance check
  canInheritFrom(user: StrictUserWithRole, targetRole: Role): boolean;
}

// ===========================================
// ERROR TYPES WITH TYPE SAFETY
// ===========================================

/**
 * Type-safe permission errors
 */
export class TypeSafePermissionError extends Error {
  readonly code: string;
  readonly userRole: Role;
  readonly requiredRole?: Role;
  readonly context: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    userRole: Role,
    requiredRole?: Role,
    context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'TypeSafePermissionError';
    this.code = code;
    this.userRole = userRole;
    this.requiredRole = requiredRole;
    this.context = context;
  }
}

/**
 * Type-safe role validation errors
 */
export class TypeSafeRoleValidationError extends Error {
  readonly invalidValue: unknown;
  readonly expectedTypes: string[];
  readonly context?: string;

  constructor(invalidValue: unknown, expectedTypes: string[], context?: string) {
    const message = `Invalid role value: ${invalidValue}. Expected: ${expectedTypes.join(' | ')}${context ? ` in ${context}` : ''}`;
    super(message);
    this.name = 'TypeSafeRoleValidationError';
    this.invalidValue = invalidValue;
    this.expectedTypes = expectedTypes;
    this.context = context;
  }
}

// ===========================================
// EXPORT UTILITIES FOR ENHANCED TYPE SAFETY
// ===========================================

export const TypeSafeRoleUtils = {
  isValidRole,
  isValidRoleArray,
  assertRole,
  assertRoleArray,
  createValidatedRole,
  TypeSafePermissionChecker,
  TypeSafePermissionError,
  TypeSafeRoleValidationError
} as const;