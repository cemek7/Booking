/**
 * Unified Authentication Utilities
 * 
 * This module provides standardized authentication and authorization utilities
 * that replace all fragmented auth patterns across the codebase.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createBrowserClient, createServerClient } from '@supabase/ssr';
import { 
  UnifiedPermissionChecker,
  initializeUnifiedPermissions,
  type UnifiedUser,
  type UnifiedPermissionContext,
  type UnifiedAccessResult
} from './unified-permissions';
import type { Role } from './roles';

// ============================================================================
// UNIFIED AUTH RESPONSE TYPES
// ============================================================================

export interface UnifiedAuthResult {
  success: boolean;
  user: UnifiedUser | null;
  response?: NextResponse;
  error?: string;
  statusCode?: number;
}

export interface UnifiedAuthOptions {
  requiredPermissions?: string[];
  requiredRoles?: Role[];
  allowSuperAdmin?: boolean;
  requireTenantAccess?: boolean;
  context?: Record<string, any>;
}

// ============================================================================
// UNIFIED AUTH MIDDLEWARE - MAIN ENTRY POINT
// ============================================================================

/**
 * Universal authentication middleware that replaces ALL requireAuth patterns
 * 
 * REPLACES:
 * - requireAuth() from various API routes
 * - hasPermission() checks scattered in routes
 * - validateTenantAccess() calls
 * - Direct tenant_users queries
 * - Manual role checking logic
 */
export async function unifiedAuth(
  request: NextRequest,
  options: UnifiedAuthOptions = {}
): Promise<UnifiedAuthResult> {
  try {
    // Step 1: Get authenticated user session
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createServerSupabaseClient(supabaseUrl, supabaseKey, { cookies });
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session?.user) {
      return createAuthFailure('Authentication required', 401);
    }

    // Step 2: Initialize unified permission checker
    const permissionChecker = initializeUnifiedPermissions(supabase);

    // Step 3: Extract tenant context from request
    const tenantContext = extractTenantContext(request);

    // Step 4: Validate tenant access if required
    if (options.requireTenantAccess && !tenantContext.tenantId) {
      return createAuthFailure('Tenant access required', 403);
    }

    // Step 5: Get unified user profile
    const user = await permissionChecker.getUserProfile(
      session.user.id, 
      tenantContext.tenantId
    );

    if (!user) {
      return createAuthFailure('User profile not found or inactive', 403);
    }

    // Step 6: Check role requirements
    if (options.requiredRoles && options.requiredRoles.length > 0) {
      const hasRole = await permissionChecker.hasAnyRole(user, options.requiredRoles);
      if (!hasRole && !(options.allowSuperAdmin && user.isSuperAdmin)) {
        return createAuthFailure(
          `Access denied. Required roles: ${options.requiredRoles.join(', ')}`,
          403
        );
      }
    }

    // Step 7: Check permission requirements
    if (options.requiredPermissions && options.requiredPermissions.length > 0) {
      const permissionContext: UnifiedPermissionContext = {
        userId: user.id,
        tenantId: user.tenantId,
        ...tenantContext,
        ...options.context
      };

      const hasPermissions = await permissionChecker.hasAllPermissions(
        user.id,
        user.tenantId,
        options.requiredPermissions,
        permissionContext
      );

      if (!hasPermissions) {
        return createAuthFailure(
          `Insufficient permissions. Required: ${options.requiredPermissions.join(', ')}`,
          403
        );
      }
    }

    // Step 8: Success - return authenticated user
    return {
      success: true,
      user
    };

  } catch (error) {
    console.error('Unified auth failed:', error);
    return createAuthFailure('Authentication error', 500);
  }
}

// ============================================================================
// SIMPLIFIED AUTH FUNCTIONS (for backward compatibility)
// ============================================================================

/**
 * Simple authentication check - replaces basic requireAuth() calls
 */
export async function requireAuth(request: NextRequest): Promise<UnifiedAuthResult> {
  return unifiedAuth(request);
}

/**
 * Authentication with permission check - replaces hasPermission() patterns
 */
export async function requirePermission(
  request: NextRequest,
  permission: string,
  context?: Record<string, any>
): Promise<UnifiedAuthResult> {
  return unifiedAuth(request, {
    requiredPermissions: [permission],
    context
  });
}

/**
 * Authentication with multiple permissions - for complex operations
 */
export async function requirePermissions(
  request: NextRequest,
  permissions: string[],
  context?: Record<string, any>
): Promise<UnifiedAuthResult> {
  return unifiedAuth(request, {
    requiredPermissions: permissions,
    context
  });
}

/**
 * Role-based authentication - replaces role checking patterns
 */
export async function requireRole(
  request: NextRequest,
  roles: Role | Role[],
  allowSuperAdmin: boolean = true
): Promise<UnifiedAuthResult> {
  const requiredRoles = Array.isArray(roles) ? roles : [roles];
  return unifiedAuth(request, {
    requiredRoles,
    allowSuperAdmin
  });
}

/**
 * Tenant-specific authentication - replaces validateTenantAccess patterns
 */
export async function requireTenantAccess(
  request: NextRequest,
  roles?: Role[],
  permissions?: string[]
): Promise<UnifiedAuthResult> {
  return unifiedAuth(request, {
    requireTenantAccess: true,
    requiredRoles: roles,
    requiredPermissions: permissions
  });
}

/**
 * Manager-level authentication - for manager-specific endpoints
 */
export async function requireManagerAccess(request: NextRequest): Promise<UnifiedAuthResult> {
  return unifiedAuth(request, {
    requiredRoles: ['manager', 'owner'],
    allowSuperAdmin: true,
    requireTenantAccess: true
  });
}

/**
 * Owner-level authentication - for owner-only operations
 */
export async function requireOwnerAccess(request: NextRequest): Promise<UnifiedAuthResult> {
  return unifiedAuth(request, {
    requiredRoles: ['owner'],
    allowSuperAdmin: true,
    requireTenantAccess: true
  });
}

/**
 * SuperAdmin authentication - for system-wide operations
 */
export async function requireSuperAdmin(request: NextRequest): Promise<UnifiedAuthResult> {
  return unifiedAuth(request, {
    requiredRoles: ['superadmin'],
    allowSuperAdmin: true
  });
}

// ============================================================================
// RESPONSE HELPERS
// ============================================================================

/**
 * Create standardized auth error responses
 */
export function createAuthErrorResponse(
  message: string,
  statusCode: number = 401
): NextResponse {
  return NextResponse.json(
    {
      error: message,
      code: 'AUTH_ERROR',
      timestamp: new Date().toISOString()
    },
    { status: statusCode }
  );
}

/**
 * Handle auth result and return appropriate response
 */
export function handleAuthResult(result: UnifiedAuthResult): NextResponse | null {
  if (!result.success) {
    return result.response || createAuthErrorResponse(
      result.error || 'Authentication failed',
      result.statusCode || 401
    );
  }
  return null;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Extract tenant context from request (URL params, headers, body)
 */
function extractTenantContext(request: NextRequest): {
  tenantId?: string;
  targetUserId?: string;
  targetTenantId?: string;
} {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Extract tenant_id from URL path
  const tenantIdMatch = pathname.match(/\/tenants\/([^\/]+)/);
  const tenantId = tenantIdMatch?.[1] || url.searchParams.get('tenant_id');

  // Extract target user from path or params
  const userIdMatch = pathname.match(/\/users\/([^\/]+)/);
  const targetUserId = userIdMatch?.[1] || url.searchParams.get('user_id');

  // Check for cross-tenant operations
  const targetTenantId = url.searchParams.get('target_tenant_id') || tenantId;

  return {
    tenantId: tenantId || undefined,
    targetUserId: targetUserId || undefined,
    targetTenantId: targetTenantId || undefined
  };
}

/**
 * Create standardized auth failure result
 */
function createAuthFailure(
  message: string,
  statusCode: number
): UnifiedAuthResult {
  return {
    success: false,
    user: null,
    error: message,
    statusCode,
    response: createAuthErrorResponse(message, statusCode)
  };
}

// ============================================================================
// MIGRATION UTILITIES
// ============================================================================

/**
 * Analyze current API routes for auth pattern migration
 */
export interface AuthMigrationAnalysis {
  routesWithLegacyAuth: string[];
  patternsToReplace: string[];
  migrationSteps: string[];
  estimatedImpact: string;
}

export function analyzeAuthMigration(): AuthMigrationAnalysis {
  return {
    routesWithLegacyAuth: [
      '/api/manager/team/route.ts',
      '/api/manager/schedule/route.ts', 
      '/api/manager/analytics/route.ts',
      '/api/jobs/dead-letter/route.ts',
      '/api/calendar/auth/route.ts'
    ],
    patternsToReplace: [
      'const supabase = createServerComponentClient({ cookies })',
      'const { data: { session } } = await supabase.auth.getSession()',
      'if (!session?.user) return NextResponse.json(...)',
      'const { data: tenantUser } = await supabase.from(\'tenant_users\')',
      'if (tenantUser?.role !== \'manager\') return NextResponse.json(...)'
    ],
    migrationSteps: [
      '1. Replace requireAuth() calls with unifiedAuth()',
      '2. Update permission checks to use requirePermission()',
      '3. Replace role checks with requireRole()', 
      '4. Update tenant validation with requireTenantAccess()',
      '5. Add proper error handling with handleAuthResult()'
    ],
    estimatedImpact: 'Medium - 20+ API routes need updating, backward compatible'
  };
}

/**
 * Generate migration template for an API route
 */
export function generateRouteMigrationTemplate(routeType: 'basic' | 'manager' | 'owner' | 'tenant'): string {
  const templates = {
    basic: `
// OLD PATTERN:
// const supabase = createServerComponentClient({ cookies });
// const { data: { session } } = await supabase.auth.getSession();
// if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

// NEW PATTERN:
import { requireAuth, handleAuthResult } from '@/types/unified-auth';

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  const authError = handleAuthResult(authResult);
  if (authError) return authError;
  
  const { user } = authResult;
  // ... rest of route logic
}`,
    
    manager: `
// OLD PATTERN:
// const { data: tenantUser } = await supabase.from('tenant_users')...
// if (!tenantUser || !['manager', 'owner'].includes(tenantUser.role)) return error;

// NEW PATTERN:
import { requireManagerAccess, handleAuthResult } from '@/types/unified-auth';

export async function POST(request: NextRequest) {
  const authResult = await requireManagerAccess(request);
  const authError = handleAuthResult(authResult);
  if (authError) return authError;
  
  const { user } = authResult;
  // ... rest of route logic
}`,
    
    owner: `
// NEW PATTERN:
import { requireOwnerAccess, handleAuthResult } from '@/types/unified-auth';

export async function DELETE(request: NextRequest) {
  const authResult = await requireOwnerAccess(request);
  const authError = handleAuthResult(authResult);
  if (authError) return authError;
  
  const { user } = authResult;
  // ... rest of route logic
}`,
    
    tenant: `
// NEW PATTERN:
import { requireTenantAccess, handleAuthResult } from '@/types/unified-auth';

export async function GET(request: NextRequest) {
  const authResult = await requireTenantAccess(request, ['staff', 'manager', 'owner']);
  const authError = handleAuthResult(authResult);
  if (authError) return authError;
  
  const { user } = authResult;
  // ... rest of route logic
}`
  };

  return templates[routeType] || '';
}