// @ts-nocheck
import { defaultLogger } from '@/lib/logger';
/**
 * Enhanced API Route Type Safety Utilities
 * Provides compile-time type safety for API routes and middleware
 */

import { NextRequest } from 'next/server';
import { Role } from '@/types/roles';
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { 
  StrictUserWithRole, 
  TypeSafePermissionChecker, 
  TypeSafePermissionError,
  RoleAwareApiResponse,
  TypeSafeMiddlewareContext
} from '@/types/unified-permissions';

// ===========================================
// API ROUTE TYPE SAFETY
// ===========================================

/**
 * Type-safe API route handler wrapper
 */
export interface TypeSafeApiHandler<TResponse = unknown> {
  (
    request: NextRequest,
    context: TypeSafeMiddlewareContext
  ): Promise<Response | RoleAwareApiResponse<TResponse>>;
}

/**
 * Type-safe route configuration
 */
export interface TypeSafeRouteConfig {
  readonly requiredRole?: Role;
  readonly allowedRoles?: readonly Role[];
  readonly requireTenantMembership?: boolean;
  readonly requireOwnership?: boolean;
}

/**
 * Create a type-safe API response
 */
export function createTypeSafeApiResponse<T>(
  data: T,
  context: TypeSafeMiddlewareContext,
  success: boolean = true
): RoleAwareApiResponse<T> {
  return {
    success,
    data: success ? data : undefined,
    error: success ? undefined : 'Operation failed',
    role_context: {
      user_role: context.user.role,
      tenant_id: context.tenant?.id,
      permissions_granted: context.permissions.granted
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Type-safe error response creator
 */
export function createTypeSafeErrorResponse(
  error: string,
  context: Partial<TypeSafeMiddlewareContext>,
  statusCode: number = 403
): RoleAwareApiResponse<never> {
  return {
    success: false,
    error,
    role_context: {
      user_role: context.user?.role || 'staff',
      tenant_id: context.tenant?.id,
      permissions_granted: false
    },
    timestamp: new Date().toISOString()
  };
}

// ===========================================
// MIDDLEWARE TYPE SAFETY
// ===========================================

/**
 * Type-safe middleware wrapper
 */
export function withTypeSafeAuth<T>(
  handler: TypeSafeApiHandler<T>,
  config: TypeSafeRouteConfig = {}
) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      // Extract user from request (implementation depends on your auth system)
      const user = await extractUserFromRequest(request);
      
      if (!user) {
        return new Response(
          JSON.stringify(createTypeSafeErrorResponse('Authentication required', {}, 401)),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Validate role requirements
      if (config.requiredRole) {
        const permissionCheck = TypeSafePermissionChecker.canAccessRole(user.role, config.requiredRole);
        
        if (!permissionCheck.granted) {
          throw new TypeSafePermissionError(
            'Insufficient permissions',
            'INSUFFICIENT_ROLE',
            user.role,
            config.requiredRole,
            { route: request.url }
          );
        }
      }

      if (config.allowedRoles) {
        const permissionCheck = TypeSafePermissionChecker.canAccessAnyRole(user.role, config.allowedRoles);
        
        if (!permissionCheck.granted) {
          throw new TypeSafePermissionError(
            'Role not in allowed list',
            'ROLE_NOT_ALLOWED',
            user.role,
            undefined,
            { allowedRoles: config.allowedRoles, route: request.url }
          );
        }
      }

      // Create type-safe context
      const context: TypeSafeMiddlewareContext = {
        user,
        tenant: user.tenant_id ? { id: user.tenant_id, name: 'Unknown' } : undefined,
        permissions: { granted: true, role: user.role, reason: 'Valid role', context: {}, timestamp: new Date().toISOString() },
        request_id: crypto.randomUUID()
      };

      // Call the handler
      const result = await handler(request, context);
      
      if (result instanceof Response) {
        return result;
      }

      // Convert RoleAwareApiResponse to Response
      return new Response(
        JSON.stringify(result),
        { 
          status: result.success ? 200 : 400, 
          headers: { 'Content-Type': 'application/json' } 
        }
      );

    } catch (error) {
      defaultLogger.error('Type-safe API error:', error);
      
      if (error instanceof TypeSafePermissionError) {
        return new Response(
          JSON.stringify(createTypeSafeErrorResponse(
            error.message,
            { user: { role: error.userRole } } as Partial<TypeSafeMiddlewareContext>,
            403
          )),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify(createTypeSafeErrorResponse(
          'Internal server error',
          {},
          500
        )),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  };
}

/**
 * Extract user from request using Supabase session verification
 */
async function extractUserFromRequest(request: NextRequest): Promise<StrictUserWithRole | null> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return null;

    const supabase = getSupabaseRouteHandlerClient();
    const { data: { user }, error } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (error || !user) return null;

    const tenantId = request.headers.get('x-tenant-id');
    if (!tenantId) return null;

    const { data: tenantUser } = await supabase
      .from('tenant_users')
      .select('role')
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!tenantUser) return null;

    return {
      id: user.id,
      email: user.email ?? '',
      role: tenantUser.role as Role,
      tenant_id: tenantId,
      permissions: [],
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as StrictUserWithRole;
  } catch {
    return null;
  }
}

// ===========================================
// TYPE-SAFE ROUTE DECORATORS
// ===========================================

/**
 * Decorator for staff-only routes
 */
export const staffRoute = <T>(handler: TypeSafeApiHandler<T>) =>
  withTypeSafeAuth(handler, { requiredRole: 'staff' });

/**
 * Decorator for manager+ routes
 */
export const managerRoute = <T>(handler: TypeSafeApiHandler<T>) =>
  withTypeSafeAuth(handler, { requiredRole: 'manager' });

/**
 * Decorator for owner+ routes
 */
export const ownerRoute = <T>(handler: TypeSafeApiHandler<T>) =>
  withTypeSafeAuth(handler, { requiredRole: 'owner' });

/**
 * Decorator for superadmin-only routes
 */
export const superadminRoute = <T>(handler: TypeSafeApiHandler<T>) =>
  withTypeSafeAuth(handler, { requiredRole: 'superadmin' });

/**
 * Decorator for multi-role routes
 */
export const multiRoleRoute = <T>(allowedRoles: readonly Role[]) => 
  (handler: TypeSafeApiHandler<T>) =>
    withTypeSafeAuth(handler, { allowedRoles });

// ===========================================
// EXPORT UTILITIES
// ===========================================

export const TypeSafeApiUtils = {
  createTypeSafeApiResponse,
  createTypeSafeErrorResponse,
  withTypeSafeAuth,
  staffRoute,
  managerRoute,
  ownerRoute,
  superadminRoute,
  multiRoleRoute
} as const;

