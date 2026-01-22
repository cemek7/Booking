/**
 * UNIFIED AUTHENTICATION MIDDLEWARE
 * 
 * Centralized authentication handling for all routes
 * Replaces scattered auth patterns with single source of truth
 * 
 * Features:
 * - Bearer token extraction and validation
 * - User session resolution
 * - Role-based access control
 * - Tenant validation
 * - Consistent error handling
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { MiddlewareContext, MiddlewareHandler } from '../orchestrator';
import { PROTECTED_ROUTES } from '@/middleware';

/**
 * User context from authentication
 */
export interface AuthUser {
  id: string;
  email: string;
  role: string;
  tenantId?: string;
  permissions?: string[];
}

/**
 * Auth configuration
 */
export interface AuthConfig {
  required?: boolean;
  publicPaths?: string[];
  requiredRoles?: string[];
  requiredPermissions?: string[];
  validateTenant?: boolean;
}

/**
 * Extract bearer token from request
 * Only checks Authorization header - Supabase session is checked via getUser()
 */
export function extractBearerToken(request: NextRequest): string | null {
  // Try Authorization header
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7); // Remove 'Bearer ' prefix
  }

  return null;
}

/**
 * Resolve authenticated user's role for middleware decisions.
 * Uses server-side auth context; does not trust client-sent role headers.
 */
export interface AuthenticatedUserRoleResult {
  role: string | null;
  isAuthenticated: boolean;
  tenantId: string | null;
}

export async function getAuthenticatedUserRole(
  request: NextRequest
): Promise<AuthenticatedUserRoleResult> {
  try {
    const supabase = getSupabaseRouteHandlerClient();

    const { data: { user: sessionUser }, error: sessionError } =
      await supabase.auth.getUser();

    let user = sessionUser;
    if (!user || sessionError) {
      const token = extractBearerToken(request);
      if (token) {
        const { data: { user: tokenUser }, error: tokenError } =
          await supabase.auth.getUser(token);
        if (!tokenError && tokenUser) {
          user = tokenUser;
        }
      }
    }

    if (!user) {
      return { role: null, isAuthenticated: false, tenantId: null };
    }

    const tenantId = request.headers.get('x-tenant-id') || null;
    if (tenantId) {
      const { data: membership, error: membershipError } = await supabase
        .from('tenant_users')
        .select('role')
        .eq('user_id', user.id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (membershipError) {
        console.error('[Auth] Tenant membership query failed:', membershipError.message);
        return { role: null, isAuthenticated: true, tenantId };
      }

      if (!membership) {
        console.warn('[Auth] Tenant membership missing for tenant:', tenantId);
        return { role: null, isAuthenticated: true, tenantId };
      }

      // Return immediately with the role we already fetched
      return { role: membership.role, isAuthenticated: true, tenantId };
    }

    // Fallback: When no tenantId header is provided, get any tenant membership
    // Orders by tenant_id for deterministic selection if user has multiple memberships
    const { data: tenantUser, error: roleError } = await supabase
      .from('tenant_users')
      .select('role, tenant_id')
      .eq('user_id', user.id)
      .order('tenant_id', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (roleError) {
      console.error('[Auth] Role query failed:', roleError.message);
      return { role: null, isAuthenticated: true, tenantId: null };
    }

    if (tenantUser) {
      return {
        role: tenantUser.role ?? null,
        isAuthenticated: true,
        tenantId: tenantUser.tenant_id ?? null,
      };
    }
    return { role: null, isAuthenticated: true, tenantId: null };
  } catch (error) {
    console.error('[Auth] Failed to resolve user role:', error);
    return { role: null, isAuthenticated: false, tenantId: null };
  }
}

/**
 * Check if path is public (doesn't require auth)
 */
export function isPublicPath(pathname: string): boolean {
  const publicPaths = [
    '/auth/signin',
    '/auth/signup',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/api/auth/signin',
    '/api/auth/signup',
    '/api/auth/verify',
    '/api/health',
    '/book/',
    '/reviews/',
  ];

  return publicPaths.some(path => pathname.startsWith(path));
}

/**
 * Extract tenant ID from request
 * Tries multiple sources: path params, query params, cookies
 */
function extractTenantId(request: NextRequest): string | null {
  const url = new URL(request.url);

  // Try query parameter
  const queryTenantId = url.searchParams.get('tenant_id') || url.searchParams.get('tenantId');
  if (queryTenantId) {
    return queryTenantId;
  }

  // Try path parameter (e.g., /api/tenants/{tenantId}/...)
  const pathMatch = url.pathname.match(/\/tenants\/([a-f0-9-]{36})/i);
  if (pathMatch && pathMatch[1]) {
    return pathMatch[1];
  }

  // Try cookie
  const cookieTenantId = request.cookies.get('tenant_id')?.value;
  if (cookieTenantId) {
    return cookieTenantId;
  }

  // Try custom header
  const headerTenantId = request.headers.get('x-tenant-id');
  if (headerTenantId) {
    return headerTenantId;
  }

  return null;
}

/**
 * Parse user role from database with tenant-aware query
 */
async function parseUserRole(
  supabase: any,
  userId: string,
  tenantId?: string
): Promise<{ role: string; permissions: string[] } | null> {
  try {
    // Validate tenantId before querying
    if (!tenantId || tenantId.trim() === '') {
      console.debug('[Auth] No valid tenantId provided, cannot look up role');
      return null;
    }

    // Query tenant_users with BOTH user_id and tenant_id filters
    // This ensures we get the correct role for multi-tenant users
    const { data, error } = await supabase
      .from('tenant_users')
      .select('role')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .maybeSingle(); // Use maybeSingle instead of single to handle not found gracefully

    if (error) {
      console.error('[Auth] Role query failed:', error.message);
      return null;
    }

    if (!data) {
      console.warn('[Auth] No role found for user in tenant', { userId, tenantId });
      return null;
    }

    return {
      role: data.role || 'staff',
      permissions: [], // Permissions can be added later if needed
    };
  } catch (error) {
    console.error('[Auth] Parse role error:', error);
    return null;
  }
}

/**
 * Unified authentication handler
 */
export const createAuthMiddleware = (_config?: AuthConfig): MiddlewareHandler => {
  return async (context: MiddlewareContext): Promise<MiddlewareContext | NextResponse> => {
    const { request } = context;
    const pathname = new URL(request.url).pathname;

    // Check if path is public
    if (isPublicPath(pathname)) {
      context.user = undefined;
      return context;
    }

    try {
      // Get Supabase client
      const supabase = getSupabaseRouteHandlerClient();

      // FIRST: Try to get user from Supabase session (via cookies)
      // This is the primary auth method for Server Components
      const { data: { user: authUser }, error: authError } = 
        await supabase.auth.getUser();

      if (authUser && !authError) {
        // ✅ Session found in cookies - user is authenticated
        // Extract tenant ID from request for role lookup
        const tenantId = extractTenantId(request);

        // Parse user role from database (tenant-aware)
        const roleData = await parseUserRole(supabase, authUser.id, tenantId || undefined);

        context.user = {
          id: authUser.id,
          email: authUser.email || '',
          role: roleData?.role || '',
          tenantId: tenantId || undefined,
          permissions: roleData?.permissions || [],
        };

        // Set user info in response headers for downstream middleware
        const response = NextResponse.next();
        response.headers.set('x-user-id', authUser.id);
        response.headers.set('x-user-role', roleData?.role || '');
        if (tenantId) {
          response.headers.set('x-tenant-id', tenantId);
        }
        context.response = response;

        return context;
      }

      // FALLBACK: Try bearer token if no session in cookies
      const token = extractBearerToken(request);
      if (token) {
        const { data: { user: tokenUser }, error: tokenError } =
          await supabase.auth.getUser(token);

        if (!tokenError && tokenUser) {
          // ✅ Token is valid - user is authenticated
          // Extract tenant ID from request for role lookup
          const tenantId = extractTenantId(request);

          // Parse user role from database (tenant-aware)
          const roleData = await parseUserRole(supabase, tokenUser.id, tenantId || undefined);

          context.user = {
            id: tokenUser.id,
            email: tokenUser.email || '',
            role: roleData?.role || '',
            tenantId: tenantId || undefined,
            permissions: roleData?.permissions || [],
          };

          // Set user info in response headers for downstream middleware
          const response = NextResponse.next();
          response.headers.set('x-user-id', tokenUser.id);
          response.headers.set('x-user-role', roleData?.role || '');
          if (tenantId) {
            response.headers.set('x-tenant-id', tenantId);
          }
          context.response = response;

          return context;
        }
      }

      // No auth found
      const error = ApiErrorFactory.missingAuthorization();
      return error.toResponse();
    } catch (error) {
      console.error('[Auth] Authentication failed:', error);
      const apiError = ApiErrorFactory.internalServerError(
        error instanceof Error ? error : undefined
      );
      return apiError.toResponse();
    }
  };
};

/**
 * Create role-based access control middleware
 */
export const createRBACMiddleware = (requiredRoles: string[]): MiddlewareHandler => {
  return async (context: MiddlewareContext): Promise<MiddlewareContext | NextResponse> => {
    if (!context.user) {
      const error = ApiErrorFactory.forbidden('Authentication required');
      return error.toResponse();
    }

    if (!requiredRoles.includes(context.user.role)) {
      const error = ApiErrorFactory.insufficientPermissions(requiredRoles);
      return error.toResponse();
    }

    return context;
  };
};

/**
 * Create tenant validation middleware
 */
export const createTenantValidationMiddleware = (): MiddlewareHandler => {
  return async (context: MiddlewareContext): Promise<MiddlewareContext | NextResponse> => {
    if (!context.user) {
      const error = ApiErrorFactory.forbidden('Authentication required');
      return error.toResponse();
    }

    // Try to extract tenant from request
    const url = new URL(context.request.url);
    const tenantIdParam = url.searchParams.get('tenant_id') ||
      new URL(context.request.url).pathname.split('/')[2]; // Extract from path

    if (tenantIdParam && !context.user.tenantId) {
      context.user.tenantId = tenantIdParam;
    }

    return context;
  };
};

/**
 * Helper to get auth config from route protection map
 */
export function getAuthConfigForRoute(pathname: string): AuthConfig | null {
  const route = Object.entries(PROTECTED_ROUTES).find(
    ([pattern]) => pathname.startsWith(pattern)
  );

  if (!route) {
    return null;
  }

  const [, config] = route;
  return config as AuthConfig;
}
