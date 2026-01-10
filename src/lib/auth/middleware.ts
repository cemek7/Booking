import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { z } from 'zod';
import type { Role } from '@/types/roles';
import { UnifiedAuthOrchestrator } from './unified-auth-orchestrator';
import { getRoleDashboardPath } from '../permissions/unified-permissions';

// PHASE 2B: Import canonical auth types from consolidated location
import type { AuthContext } from '@/types/auth';

// Re-export for backward compatibility
export type { AuthContext };

// ============================================================================
// MIDDLEWARE OPTION SCHEMAS & TYPES (consolidated from auth-middleware.ts)
// ============================================================================

const AuthMiddlewareOptionsSchema = z.object({
  session: z.any().optional(),
  userRole: z.string().optional(),
  supabase: z.any(),
  protectedRoutes: z.record(z.array(z.string())),
});

export type AuthMiddlewareOptions = z.infer<typeof AuthMiddlewareOptionsSchema>;

// ============================================================================
// CORE AUTHENTICATION FUNCTIONS (unified from both middleware files)
// ============================================================================

/**
 * Server-side authentication and role validation middleware
 * Now delegates to unified orchestrator for consistency
 * 
 * PHASE 2C: Consolidated from both middleware.ts and auth-middleware.ts
 */
export async function validateDashboardAccess(
  request: NextRequest,
  requiredRole?: Role | Role[]
): Promise<{ success: true; context: AuthContext } | { success: false; redirect: string }> {
  try {
    const orchestrator = UnifiedAuthOrchestrator.getInstance();
    
    // Use unified session resolution
    let authContext;
    try {
      authContext = await orchestrator.resolveSession(request);
    } catch (error) {
      return { success: false, redirect: '/auth/signin' };
    }

    // Get tenant info
    const supabase = createServerSupabaseClient();
    const { data: tenantData } = await supabase
      .from('tenants')
      .select('id, name')
      .eq('id', authContext.tenantId)
      .single();
    
    // Validate role if required
    if (requiredRole) {
      const allowedRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
      if (!orchestrator.validateRole(authContext, allowedRoles)) {
        return { success: false, redirect: '/dashboard/unauthorized' };
      }
    }

    return {
      success: true,
      context: {
        user: {
          id: authContext.userId,
          email: authContext.email,
          role: authContext.role
        },
        tenant: tenantData ? {
          id: tenantData.id,
          name: tenantData.name
        } : null
      }
    };

  } catch (error) {
    console.error('Auth validation error:', error);
    return { success: false, redirect: '/auth/error' };
  }
}

/**
 * Enhanced middleware with Zod validation and protected route checking
 * Consolidated from auth-middleware.ts withAuth function
 * 
 * PHASE 2C: Unified with validateDashboardAccess for single middleware implementation
 */
export async function withAuth(
  request: NextRequest,
  options: AuthMiddlewareOptions
): Promise<NextResponse | null> {
  const { session, userRole, protectedRoutes } = options;
  const pathname = request.nextUrl.pathname;

  // Public routes that are always accessible
  const publicPaths = ['/auth/signin', '/auth/signup', '/auth/forgot-password', '/auth/reset-password'];
  if (publicPaths.some(path => pathname.startsWith(path))) {
    return null;
  }

  if (!session) {
    // Unauthenticated users trying to access protected routes are redirected to signin
    const isProtectedRoute = Object.keys(protectedRoutes).some(route => pathname.startsWith(route));
    if (isProtectedRoute) {
      return NextResponse.redirect(new URL('/auth/signin', request.url));
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
  if (pathname.startsWith('/superadmin/')) return 'superadmin';
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