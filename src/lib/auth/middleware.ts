import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Role } from '@/types/roles';
import { getRoleDashboardPath } from '@/types/unified-permissions';

import type { AuthContext } from '@/types/auth';

export type { AuthContext };

// ============================================================================
// MIDDLEWARE OPTION SCHEMAS & TYPES
// ============================================================================

export interface AuthMiddlewareOptions {
  session?: unknown;
  userRole?: string;
  supabase: unknown;
  protectedRoutes: Record<string, string[]>;
}

// ============================================================================
// CORE AUTHENTICATION FUNCTIONS (unified from both middleware files)
// ============================================================================

/**
 * Enhanced middleware with Zod validation and protected route checking
 */
export async function withAuth(
  request: NextRequest,
  options: AuthMiddlewareOptions
): Promise<NextResponse | null> {
  const { session, userRole, protectedRoutes } = options;
  const pathname = request.nextUrl.pathname;

  // Public routes that are always accessible
  const publicPaths = [
    '/booka/auth/signin',
    '/booka/auth/signup',
    '/booka/auth/onboarding',
    '/booka/auth/callback',
    '/auth/signin',
    '/auth/signup',
    '/auth/onboarding',
    '/auth/callback',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/api/auth/callback',
  ];
  if (publicPaths.some(path => pathname.startsWith(path))) {
    return null;
  }

  if (!session) {
    // Unauthenticated users trying to access protected routes are redirected to signin
    const isProtectedRoute = Object.keys(protectedRoutes).some(route => pathname.startsWith(route));
    if (isProtectedRoute) {
      return NextResponse.redirect(new URL('/booka/auth/signin', request.url));
    }
    return null; // Allow access to other non-protected public pages
  }

  // Authenticated users are checked for role-based access
  const requiredRoles = Object.entries(protectedRoutes).find(([route]) => pathname.startsWith(route))?.[1];

  if (requiredRoles && requiredRoles.length > 0) {
    if (!userRole || !requiredRoles.includes(userRole)) {
      // If user doesn't have the required role, redirect to their default dashboard
      const userDashboard = getRoleDashboardPath(userRole || 'staff');
      return NextResponse.redirect(new URL(userDashboard, request.url));
    }
  }

  return null; // User has access
}

// ============================================================================
// ROUTE-SPECIFIC HELPERS
// ============================================================================

/**
 * Route-specific role validation
 * Maps URL paths to required roles
 */
export function getRequiredRoleForRoute(pathname: string): Role | Role[] | null {
  if (pathname.startsWith('/owner/')) return 'owner';
  if (pathname.startsWith('/manager/')) return 'manager';
  if (pathname.startsWith('/staff/')) return 'staff';
  if (pathname.startsWith('/dashboard/superadmin/')) return 'superadmin';
  if (pathname === '/dashboard/owner') return 'owner';
  if (pathname === '/dashboard/manager') return 'manager';
  if (pathname === '/dashboard/staff-dashboard') return 'staff';
  if (pathname.startsWith('/dashboard/')) {
    return ['superadmin', 'owner', 'manager', 'staff'];
  }
  return null;
}

/**
 * Tenant isolation validation
 * Ensures user has access to the specified tenant
 */
export async function validateTenantAccess(
  tenantId: string, 
  userId: string
): Promise<boolean> {
  try {
    const supabase = createServerSupabaseClient();
    
    const { data, error } = await supabase
      .from('tenant_users')
      .select('id')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .single();
    
    return !error && !!data;
  } catch {
    return false;
  }
}
