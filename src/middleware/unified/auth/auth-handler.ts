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

import { defaultLogger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { MiddlewareContext, MiddlewareHandler } from '../orchestrator';
import { PROTECTED_ROUTES } from '@/middleware';
import { isActiveGlobalAdmin } from '@/lib/auth/global-admin';

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

async function isSuperadminUser(_userId: string, email?: string | null): Promise<boolean> {
  return isActiveGlobalAdmin(createSupabaseAdminClient(), email);
}

export async function getAuthenticatedUserRole(
  request: NextRequest
): Promise<AuthenticatedUserRoleResult> {
  try {
    const supabase = createServerSupabaseClient();

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

    if (await isSuperadminUser(user.id, user.email)) {
      return { role: 'superadmin', isAuthenticated: true, tenantId: 'global' };
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
        defaultLogger.error('[Auth] Tenant membership query failed:', membershipError.message);
        return { role: null, isAuthenticated: true, tenantId };
      }

      if (!membership) {
        defaultLogger.warn('[Auth] Tenant membership missing for tenant:', tenantId);
        return { role: null, isAuthenticated: true, tenantId };
      }

      // Return immediately with the role we already fetched
      return { role: membership.role, isAuthenticated: true, tenantId };
    }

    // Fallback: When no tenantId header is provided, auto-select only if user
    // has exactly one membership. If multiple, require explicit x-tenant-id header.
    const { data: tenantMemberships, error: roleError } = await supabase
      .from('tenant_users')
      .select('role, tenant_id')
      .eq('user_id', user.id)
      .order('tenant_id', { ascending: true })
      .limit(2);

    if (roleError) {
      defaultLogger.error('[Auth] Role query failed:', roleError.message);
      return { role: null, isAuthenticated: true, tenantId: null };
    }

    if (tenantMemberships && tenantMemberships.length === 1) {
      return {
        role: tenantMemberships[0].role ?? null,
        isAuthenticated: true,
        tenantId: tenantMemberships[0].tenant_id ?? null,
      };
    }

    if (tenantMemberships && tenantMemberships.length > 1) {
      // Ambiguous: user belongs to multiple tenants and didn't specify which one
      defaultLogger.warn('[Auth] User has multiple tenant memberships but no x-tenant-id header');
      return { role: null, isAuthenticated: true, tenantId: null };
    }

    return { role: null, isAuthenticated: true, tenantId: null };
  } catch (error) {
    defaultLogger.error('[Auth] Failed to resolve user role:', error);
    return { role: null, isAuthenticated: false, tenantId: null };
  }
}

/**
 * Check if path is public (doesn't require auth)
 */
export function isPublicPath(pathname: string): boolean {
  const publicPaths = [
    '/',
    '/booka',
    '/products',
    '/booka/auth/signin',
    '/booka/auth/signup',
    '/booka/auth/onboarding',
    '/booka/auth/callback',
    '/booka/auth/select-tenant',
    '/booka/auth/forbidden',
    '/booka/auth/unauthorized',
    '/auth/signin',
    '/auth/signup',
    '/auth/callback',
    '/auth/onboarding',
    '/auth/select-tenant',
    '/auth/forbidden',
    '/auth/unauthorized',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/api/auth/signin',
    '/api/auth/signup',
    '/api/auth/callback',
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
  supabase: SupabaseClient,
  userId: string,
  tenantId?: string
): Promise<{ role: string; permissions: string[] } | null> {
  try {
    // Validate tenantId before querying
    if (!tenantId || tenantId.trim() === '') {
      defaultLogger.debug('[Auth] No valid tenantId provided, cannot look up role');
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
      defaultLogger.error('[Auth] Role query failed:', error.message);
      return null;
    }

    if (!data) {
      defaultLogger.warn('[Auth] No role found for user in tenant', { userId, tenantId });
      return null;
    }

    return {
      role: data.role || 'staff',
      permissions: [], // Permissions can be added later if needed
    };
  } catch (error) {
    defaultLogger.error('[Auth] Parse role error:', error);
    return null;
  }
}

/**
 * Unified authentication handler
 */
export const createAuthMiddleware = (_config?: AuthConfig): MiddlewareHandler => {
  void _config;
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
      const supabase = createServerSupabaseClient();

      // FIRST: Try to get user from Supabase session (via cookies)
      // This is the primary auth method for Server Components
      const { data: { user: authUser }, error: authError } = 
        await supabase.auth.getUser();

      if (authUser && !authError) {
        // ✅ Session found in cookies - user is authenticated
        // Extract tenant ID from request for role lookup
        const tenantId = extractTenantId(request);
        const isSuperadmin = await isSuperadminUser(authUser.id, authUser.email);

        // Parse user role from database (tenant-aware)
        const roleData = isSuperadmin
          ? { role: 'superadmin', permissions: [] }
          : await parseUserRole(supabase, authUser.id, tenantId || undefined);

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
          const isSuperadmin = await isSuperadminUser(tokenUser.id, tokenUser.email);

          // Parse user role from database (tenant-aware)
          const roleData = isSuperadmin
            ? { role: 'superadmin', permissions: [] }
            : await parseUserRole(supabase, tokenUser.id, tenantId || undefined);

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
      defaultLogger.error('[Auth] Authentication failed:', error);
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

  const [, requiredRoles] = route;
  return { required: true, requiredRoles };
}
