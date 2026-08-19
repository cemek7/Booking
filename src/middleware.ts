import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { middlewareOrchestrator } from '@/middleware/unified/orchestrator';
import { initializeUnifiedMiddleware } from '@/middleware/unified/middleware-adapter';
import { getRoleDashboardPath } from '@/types/unified-permissions';
import { isValidRole } from '@/types/roles';
import { getAuthenticatedUserRole } from '@/middleware/unified/auth/auth-handler';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { isTenantOnboardingIncomplete } from '@/lib/onboarding/state';
import { isBookaDashboardPath, toBookaDashboardPath, toInternalDashboardPath } from '@/lib/navigation/dashboard-path';

export const runtime = 'nodejs';

// Role-based route protection patterns
// Exported for use by auth middleware
// NOTE: Object.entries().find() returns the FIRST matching key, so more-specific
// prefixes must be listed BEFORE less-specific ones (e.g. /dashboard/staff/management
// before /dashboard/staff before /dashboard).
export const PROTECTED_ROUTES: Record<string, string[]> = {
  // Top-level role sections
  '/manager': ['manager', 'owner'],
  '/staff': ['staff', 'manager', 'owner'],

  // Superadmin
  '/dashboard/superadmin': ['superadmin'],
  '/dashboard/superadmin/staff': ['superadmin'],

  // Owner-only
  '/dashboard/owner': ['owner'],
  '/dashboard/usage': ['owner'],
  '/dashboard/billing': ['owner'],
  '/dashboard/settings': ['owner'],

  // Manager + owner (more-specific staff sub-paths first)
  '/dashboard/ops': ['manager', 'owner'],
  '/dashboard/leads': ['manager', 'owner'],
  '/dashboard/staff/management': ['manager', 'owner'],
  '/dashboard/staff/scheduling': ['manager', 'owner'],
  '/dashboard/staff': ['manager', 'owner'],
  '/dashboard/manager': ['manager', 'owner'],
  '/dashboard/customers': ['manager', 'owner'],
  '/dashboard/faqs': ['manager', 'owner'],
  '/dashboard/products': ['manager', 'owner'],
  '/dashboard/reports': ['manager', 'owner'],
  '/dashboard/services': ['manager', 'owner'],
  '/dashboard/analytics': ['owner', 'manager', 'superadmin'],

  // Staff + manager + owner
  '/dashboard/bookings': ['owner', 'manager', 'staff'],
  '/dashboard/chats': ['owner', 'manager', 'staff'],
  '/dashboard/schedule': ['owner', 'manager', 'staff'],
  '/dashboard/staff-dashboard': ['staff', 'manager', 'owner'],
  '/dashboard/tasks': ['owner', 'manager', 'staff'],

  // Catch-all: any authenticated user (must be last)
  '/dashboard': ['owner', 'manager', 'staff', 'superadmin'],
};

// Initialize middleware on first run — use a promise gate to prevent concurrent cold-start races
let middlewareInitPromise: Promise<void> | null = null;
async function ensureMiddlewareInitialized() {
  if (!middlewareInitPromise) {
    middlewareInitPromise = initializeUnifiedMiddleware();
  }
  await middlewareInitPromise;
}

function makeNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.ngrok-free.app') ||
    hostname.endsWith('.ngrok.app') ||
    hostname.endsWith('.ngrok.io')
  );
}

function buildContentSecurityPolicy(nonce: string, local: boolean): string {
  const posthogScriptSrc = 'https://us-assets.i.posthog.com';
  const posthogConnectSrc = 'https://us.i.posthog.com';

  if (local) {
    return [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${posthogScriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      `connect-src 'self' http://localhost:* https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://api.paystack.co ${posthogScriptSrc} ${posthogConnectSrc}`,
      "frame-ancestors 'none'",
    ].join('; ');
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${posthogScriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://api.paystack.co ${posthogScriptSrc} ${posthogConnectSrc}`,
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Process an incoming Next.js request through the unified middleware chain and apply a root-path redirect for authenticated users.
 *
 * Ensures the unified middleware system is initialized, executes the orchestrator, and if the request path is `/` and the `x-user-role` header contains a valid role, redirects to that role's dashboard.
 *
 * @returns The HTTP response produced by the unified middleware orchestrator, or a redirect response to a role-specific dashboard when applicable.
 */
export async function middleware(request: NextRequest) {
  const nonce = makeNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  const csp = buildContentSecurityPolicy(nonce, isLocalHost(request.nextUrl.hostname));
  const pathname = request.nextUrl.pathname;

  // Keep long-lived /dashboard links working while presenting one public,
  // Booka-branded workspace URL. The canonical URL is rewritten internally
  // after authentication so the existing App Router pages remain reusable.
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
    const target = request.nextUrl.clone();
    target.pathname = toBookaDashboardPath(pathname);
    const response = NextResponse.redirect(target);
    response.headers.set('Content-Security-Policy', csp);
    return response;
  }
  const shouldRewriteBookaDashboard = isBookaDashboardPath(pathname);

  // Redirect legacy /login route
  if (request.nextUrl.pathname === '/login') {
    const response = NextResponse.redirect(new URL('/booka/auth/signin', request.url));
    response.headers.set('Content-Security-Policy', csp);
    return response;
  }
  // Redirect legacy /onboarding route to new location
  if (request.nextUrl.pathname.startsWith('/onboarding')) {
    const response = NextResponse.redirect(new URL(request.nextUrl.pathname.replace('/onboarding', '/booka/auth/onboarding'), request.url));
    response.headers.set('Content-Security-Policy', csp);
    return response;
  }
  // Redirect old /admin/* routes to /dashboard/superadmin/*
  if (request.nextUrl.pathname === '/admin' || request.nextUrl.pathname.startsWith('/admin/')) {
    const newPath = request.nextUrl.pathname.replace(/^\/admin/, '/dashboard/superadmin');
    const response = NextResponse.redirect(new URL(newPath + request.nextUrl.search, request.url));
    response.headers.set('Content-Security-Policy', csp);
    return response;
  }
  // Redirect old /superadmin route to /dashboard/superadmin
  if (request.nextUrl.pathname === '/superadmin' || request.nextUrl.pathname.startsWith('/superadmin/')) {
    const newPath = request.nextUrl.pathname.replace(/^\/superadmin/, '/dashboard/superadmin');
    const response = NextResponse.redirect(new URL(newPath + request.nextUrl.search, request.url));
    response.headers.set('Content-Security-Policy', csp);
    return response;
  }

  // Initialize middleware system (runs once)
  await ensureMiddlewareInitialized();

  // Execute unified middleware chain
  const response = await middlewareOrchestrator.execute(request);

  // Extract context from response if available (for role validation)
  if (pathname === '/' && response.status === 200) {
    const { role: resolvedRole, isAuthenticated, tenantId } = await getAuthenticatedUserRole(request);
    const role = resolvedRole?.toLowerCase() ?? null;
    if (role && isValidRole(role)) {
      if (tenantId && tenantId !== 'global') {
        const admin = createSupabaseAdminClient();
        const { data: tenant } = await admin
          .from('tenants')
          .select('settings, metadata')
          .eq('id', tenantId)
          .maybeSingle();

        if (isTenantOnboardingIncomplete(tenant)) {
          return NextResponse.redirect(new URL('/booka/auth/onboarding?resume=1', request.url));
        }
      }

      const dashboardPath = getRoleDashboardPath(role);
      return NextResponse.redirect(new URL(dashboardPath, request.url));
    }
    if (isAuthenticated && tenantId && !role) {
      return NextResponse.redirect(new URL('/auth/unauthorized', request.url));
    }
    // If no authenticated user is available, skip redirect.
  }
  const isPassThrough = response.status === 200 && !response.headers.get('location');
  const finalResponse = isPassThrough
    ? NextResponse.next({ request: { headers: requestHeaders } })
    : response;

  if (isPassThrough) {
    response.headers.forEach((value, key) => {
      finalResponse.headers.set(key, value);
    });
  }

  finalResponse.headers.set('Content-Security-Policy', csp);

  if (isPassThrough && shouldRewriteBookaDashboard) {
    const internalUrl = request.nextUrl.clone();
    internalUrl.pathname = toInternalDashboardPath(pathname);
    const rewrite = NextResponse.rewrite(internalUrl, { request: { headers: requestHeaders } });
    finalResponse.headers.forEach((value, key) => rewrite.headers.set(key, value));
    return rewrite;
  }

  return finalResponse;
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
    '/((?!api|monitoring|_next/static|_next/image|favicon.ico).*)',
  ],
};
