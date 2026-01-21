import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { middlewareOrchestrator } from '@/middleware/unified/orchestrator';
import { initializeUnifiedMiddleware } from '@/middleware/unified/middleware-adapter';
import { getRoleDashboardPath } from './lib/permissions/unified-permissions';
import { isValidRole } from '@/types/roles';

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
 * Process an incoming Next.js request through the unified middleware chain and apply a root-path redirect for authenticated users.
 *
 * Ensures the unified middleware system is initialized, executes the orchestrator, and if the request path is `/` and the `x-user-role` header contains a valid role, redirects to that role's dashboard.
 *
 * @returns The HTTP response produced by the unified middleware orchestrator, or a redirect response to a role-specific dashboard when applicable.
 */
export async function middleware(request: NextRequest) {
  // Initialize middleware system (runs once)
  await ensureMiddlewareInitialized();

  // Execute unified middleware chain
  const response = await middlewareOrchestrator.execute(request);

  // Handle root path redirect for authenticated users
  const pathname = request.nextUrl.pathname;
  if (pathname === '/' && response.status === 200) {
    const roleHeader = request.headers.get('x-user-role');
    const role = roleHeader?.toLowerCase() ?? null;
    if (role && isValidRole(role)) {
      const dashboardPath = getRoleDashboardPath(role);
      return NextResponse.redirect(new URL(dashboardPath, request.url));
    }
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