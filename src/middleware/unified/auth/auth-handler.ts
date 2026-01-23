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
export async function getAuthenticatedUserRole(
  request: NextRequest
): Promise<{ role: string | null; isAuthenticated: boolean; tenantId: string | null }> {
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
    if (!tenantId) {
      const { data: memberships, error: membershipsError } = await supabase
        .from('tenant_users')
        .select('tenant_id, role')
        .eq('user_id', user.id)
        .limit(2);

      if (membershipsError) {
        console.error('[Auth] Tenant membership query failed:', membershipsError.message);
        return { role: null, isAuthenticated: true, tenantId: null };
      }

      if (memberships?.length === 1) {
        const membership = memberships[0];
        return {
          role: membership?.role ?? null,
          isAuthenticated: true,
          tenantId: membership?.tenant_id ?? null,
        };
      }

      return { role: null, isAuthenticated: true, tenantId: null };
    }

    const roleQuery = supabase
      .from('tenant_users')
      .select('role')
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId);
    const { data: tenantUser, error: roleError } = await roleQuery.maybeSingle();

    if (roleError) {
      console.error('[Auth] Role query failed:', roleError.message);
      return { role: null, isAuthenticated: true, tenantId };
    }

    if (tenantUser?.role) {
      return { role: tenantUser.role, isAuthenticated: true, tenantId };
    }

    const retryRoleQuery = supabase
      .from('tenant_users')
      .select('role')
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId);
    const { data: retryTenantUser, error: retryError } = await retryRoleQuery.maybeSingle();

    if (retryError) {
      console.error('[Auth] Role retry query failed:', retryError.message);
      return { role: null, isAuthenticated: true, tenantId };
    }

    return { role: retryTenantUser?.role ?? null, isAuthenticated: true, tenantId };
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
  ];

  return publicPaths.some(path => pathname.startsWith(path));
}

/**
 * Parse user role from database
 */
async function parseUserRole(
  supabase: any,
  userId: string,
  tenantId?: string
): Promise<{ role: string; permissions: string[] } | null> {
  try {
    // If no tenantId provided, can't look up role in tenant_users
    if (!tenantId) {
      console.debug('[Auth] No tenantId provided, using default role');
      return {
        role: 'staff',
        permissions: [],
      };
    }

    const { data, error } = await supabase
      .from('tenant_users')
      .select('role')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      console.error('[Auth] Role query failed:', error.message);
      return null;
    }

    return {
      role: data?.role || 'staff',
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
export const createAuthMiddleware = (config?: AuthConfig): MiddlewareHandler => {
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
        // Middleware just verifies authentication
        // Frontend has actual role in localStorage, API can get it from headers if needed
        context.user = {
          id: authUser.id,
          email: authUser.email || '',
          role: '', // Empty - frontend owns the role from localStorage
          permissions: [],
        };

        return context;
      }

      // FALLBACK: Try bearer token if no session in cookies
      const token = extractBearerToken(request);
      if (token) {
        const { data: { user: tokenUser }, error: tokenError } = 
          await supabase.auth.getUser(token);
        
        if (!tokenError && tokenUser) {
          // ✅ Token is valid - user is authenticated
          // Middleware just verifies authentication
          // Frontend has actual role in localStorage, API can get it from headers if needed
          context.user = {
            id: tokenUser.id,
            email: tokenUser.email || '',
            role: '', // Empty - frontend owns the role from localStorage
            permissions: [],
          };

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
