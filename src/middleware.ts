import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { middlewareOrchestrator } from '@/middleware/unified/orchestrator';
import { initializeUnifiedMiddleware } from '@/middleware/unified/middleware-adapter';
import { getRoleDashboardPath } from './lib/permissions/unified-permissions';
import { isValidRole } from '@/types/roles';
import { getAuthenticatedUserRole } from '@/middleware/unified/auth/auth-handler';

export const runtime = 'nodejs';

// Role-based route protection patterns
// Exported for use by auth middleware
export const PROTECTED_ROUTES: Record<string, string[]> = {
  '/owner': ['owner'],
  '/manager': ['manager', 'owner'],
  '/staff': ['staff', 'manager', 'owner'], 
  '/superadmin': ['superadmin'],
  '/admin': ['superadmin'],
  '/dashboard/owner': ['owner'],
  '/dashboard/manager': ['manager', 'owner'], 
  '/dashboard/staff-dashboard': ['staff', 'manager', 'owner'],
  '/dashboard/settings': ['owner'],
  '/dashboard/billing': ['owner'],
  '/dashboard/staff/management': ['manager', 'owner'],
  '/dashboard/staff/scheduling': ['manager', 'owner']
};

// Initialize middleware on first run
let middlewareInitialized = false;
async function ensureMiddlewareInitialized() {
  if (!middlewareInitialized) {
    await initializeUnifiedMiddleware();
    middlewareInitialized = true;
  }
}

/**
 * Unified middleware entry point
 * Uses orchestrator for composable, reusable middleware chain
 */
export async function middleware(request: NextRequest) {
  // Initialize middleware system (runs once)
  await ensureMiddlewareInitialized();

  // Execute unified middleware chain
  const response = await middlewareOrchestrator.execute(request);

  // Handle root path redirect for authenticated users
  const pathname = request.nextUrl.pathname;
  if (pathname === '/' && response.status === 200) {
    const { role: resolvedRole, isAuthenticated } = await getAuthenticatedUserRole(request);
    const role = resolvedRole?.toLowerCase() ?? null;
    if (role && isValidRole(role)) {
      const dashboardPath = getRoleDashboardPath(role);
      return NextResponse.redirect(new URL(dashboardPath, request.url));
    }
    if (isAuthenticated && !role) {
      return NextResponse.redirect(new URL('/auth/unauthorized', request.url));
    }
    // If no authenticated user is available, skip redirect.
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
