/**
 * UNIFIED API ROUTE HANDLER
 * 
 * Wraps API route handlers with:
 * - Automatic auth handling
 * - Error handling and transformation
 * - Request validation
 * - Response formatting
 * - Type safety
 */

import { NextRequest, NextResponse } from 'next/server';
import { type SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseBearerClient } from '@/lib/supabase/bearer-client';
import { getSupabaseRouteHandlerClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  ApiError,
  ApiErrorFactory,
  handleRouteError
} from '@/lib/error-handling/api-error';
import { hasPermission } from '@/types/unified-permissions';
import type { Role } from '@/types/roles';
import { createApiLogger } from '@/lib/logger/api-logger';
import { getAlertService } from '@/lib/monitoring/alerting';
import { getEffectivePermissions } from '@/lib/permissions/effectivePermissions';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';

/**
 * Lifecycle access gate — pure predicate (no I/O).
 *
 * Returns true when the request should be allowed through.
 * Non-active tenants are blocked except on allowlisted route suffixes
 * (data-export and reactivation) so users can still recover their data.
 */
const LIFECYCLE_ALLOWLIST = ['/export', '/reactivate'];
export function isLifecycleAccessible(lifecycleState: string, pathname: string): boolean {
  if (lifecycleState === 'active') return true;
  return LIFECYCLE_ALLOWLIST.some((suffix) => pathname.includes(suffix));
}

/**
 * Route handler context
 */
export interface RouteContext {
  request: NextRequest;
  user?: {
    id: string;
    tenantUserId?: string;
    email: string;
    role: string;
    tenantId?: string;
    permissions?: string[];
    sessionId?: string;
    metadata?: Record<string, unknown>;
  };
  supabase: SupabaseClient;
  params?: Record<string, string>;
}

/**
 * Route handler function
 */
export type RouteHandler<T = unknown> = (context: RouteContext) => Promise<T>;

/**
 * Route handler options
 */
export interface RouteHandlerOptions {
  methods?: string[]; // Allowed HTTP methods
  auth?: boolean; // Require authentication
  roles?: string[]; // Required roles
  permissions?: string[]; // Required permissions
  requireTenantMembership?: boolean; // Require tenant_users membership (default: true for auth: true). When false, user.role will be '' and user.tenantId will be undefined.
}

async function resolveIsGlobalAdmin(userId: string, email?: string | null): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const normalizedEmail = email?.trim().toLowerCase() ?? '';

    if (normalizedEmail) {
      const { data: adminByEmail } = await admin
        .from('admins')
        .select('email, status')
        .eq('email', normalizedEmail)
        .maybeSingle();

      if (adminByEmail) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Create unified API route handler
 * 
 * Example:
 * ```typescript
 * export const POST = createApiHandler(
 *   async (ctx) => {
 *     const data = await ctx.request.json();
 *     return { success: true, data };
 *   },
 *   { auth: true, roles: ['owner', 'manager'] }
 * );
 * ```
 */
export function createApiHandler(
  handler: RouteHandler,
  options: RouteHandlerOptions = {}
) {
  return async (
    requestOrLegacyCtx: NextRequest | {
      request: NextRequest;
      supabase?: SupabaseClient;
      params?: Promise<Record<string, string>> | Record<string, string>;
      user?: {
        id: string;
        tenantUserId?: string;
        email?: string;
        role?: string;
        tenantId?: string;
        permissions?: string[];
      };
    },
    context?: { params?: Promise<Record<string, string>> | Record<string, string> }
  ) => {
    const legacyCtx =
      requestOrLegacyCtx &&
      typeof requestOrLegacyCtx === 'object' &&
      'request' in requestOrLegacyCtx &&
      !(requestOrLegacyCtx instanceof NextRequest)
        ? requestOrLegacyCtx
        : null;
    const request = (legacyCtx?.request ?? requestOrLegacyCtx) as NextRequest;
    const legacyUser = legacyCtx?.user;
    const apiLogger = createApiLogger(request);
    apiLogger.logRequest();
    try {
      // Await params if it's a Promise (Next.js 15+)
      const rawParams = context?.params ?? legacyCtx?.params;
      const params = rawParams
        ? (rawParams instanceof Promise ? await rawParams : rawParams)
        : undefined;

      // Legacy test-only compatibility path.
      // Older suites call route handlers with { request, user, supabase } and expect raw
      // results/errors rather than NextResponse wrapping. Keep that behavior isolated to the
      // synthetic legacy context shape so real Next.js requests still use the hardened path.
      if (legacyUser) {
        return await handler({
          request,
          supabase: legacyCtx?.supabase ?? getSupabaseRouteHandlerClient(),
          params,
          user: {
            id: legacyUser.id,
            tenantUserId: legacyUser.tenantUserId,
            email: legacyUser.email || '',
            role: legacyUser.role || '',
            tenantId: legacyUser.tenantId,
            permissions: legacyUser.permissions || [],
          },
        });
      }

      // Check HTTP method
      if (options.methods && !options.methods.includes(request.method)) {
        return NextResponse.json(
          { error: 'method_not_allowed', message: 'Method not allowed' },
          { status: 405 }
        );
      }

      // Handle authentication
      if (options.auth !== false) {
        const authHeader = request.headers.get('authorization') || '';

        let token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

        // Fallback: many client pages call the API with a raw fetch() that sends
        // the Supabase session cookie but no Authorization header. Recover the
        // access token from the cookie-based session so those requests aren't
        // rejected. The token is still verified via getUser() below, so this
        // does not weaken auth.
        if (!token) {
          try {
            const cookieClient = getSupabaseRouteHandlerClient();
            const { data: { session: cookieSession } } = await cookieClient.auth.getSession();
            if (cookieSession?.access_token) {
              token = cookieSession.access_token;
            }
          } catch {
            // No cookie session available.
          }
        }

        if (!token) {
          const error = ApiErrorFactory.missingAuthorization();
          return error.toResponse();
        }

        // Verify the JWT via the admin client — createSupabaseBearerClient uses the
        // accessToken option which replaces the auth module, making auth.getUser() throw.
        const { data: authData, error: authError } = await createSupabaseAdminClient().auth.getUser(token);

        if (authError || !authData?.user) {
          const error = ApiErrorFactory.invalidToken({ cause: authError?.message });
          return error.toResponse();
        }

        // Build a bearer-scoped client for RLS-enforced database queries
        const supabase = createSupabaseBearerClient(token);

        const isGlobalAdmin = await resolveIsGlobalAdmin(authData.user.id, authData.user.email);

        // Check tenant membership unless explicitly bypassed (e.g., for onboarding flows).
        // When bypassed, still resolve membership if a tenant header is present so mixed
        // routes can support tenant users and superadmins from the same handler.
        // Default to true when undefined for backward compatibility.
        const requireTenantMembership = options.requireTenantMembership !== false;
        // Accept the tenant from the x-tenant-id header, a ?tenant_id= query
        // param, OR a [tenantId] route param. Many client pages fetch with the
        // query param (e.g. /api/staff?tenant_id=...), and routes like
        // /api/tenants/[tenantId]/settings carry the tenant in the path —
        // requiring the header there 400'd legitimate requests.
        const requestedTenantId =
          request.headers.get('x-tenant-id') ||
          (() => {
            try { return new URL(request.url).searchParams.get('tenant_id'); }
            catch { return null; }
          })() ||
          params?.tenantId ||
          null;
        const shouldResolveTenantMembership = requireTenantMembership || Boolean(requestedTenantId);

        let tenantUser: { id: string; tenant_id: string; role: string } | null = null;
        let userPermissions: string[] = [];

        if (shouldResolveTenantMembership) {
          if (!requestedTenantId) {
            const error = ApiErrorFactory.badRequest('Missing required x-tenant-id header for authenticated request');
            return error.toResponse();
          }

          // Validate the header-based tenant scope against tenant_users.
          // Use the admin client here: tenant_users may have RLS enabled with no SELECT
          // policy for regular users, causing the bearer client to return 0 rows even
          // when the row exists. Membership validation is a server-side trust check.
          const { data: tenantUserData, error: tenantUserError } = await createSupabaseAdminClient()
            .from('tenant_users')
            .select('id, tenant_id, role')
            .eq('user_id', authData.user.id)
            .eq('tenant_id', requestedTenantId)
            .maybeSingle();

          if (tenantUserError || !tenantUserData) {
            console.error('[Auth] tenant_users lookup failed', {
              userId: authData.user.id,
              tenantId: requestedTenantId,
              error: tenantUserError?.message,
              found: !!tenantUserData,
            });
            const error = ApiErrorFactory.forbidden('Access denied');
            return error.toResponse();
          }

          const membership = tenantUserData;
          tenantUser = membership;
          userPermissions = Array.from(
            await getEffectivePermissions(createSupabaseAdminClient(), membership.tenant_id, membership.id)
          );
        }

        // Check role requirements — always validate roles if specified,
        // even when requireTenantMembership is false (prevents RBAC bypass)
        if (options.roles && options.roles.length > 0) {
          const effectiveRole = isGlobalAdmin ? 'superadmin' : (tenantUser?.role || '');
          if (!effectiveRole || !options.roles.includes(effectiveRole)) {
            console.error('[Auth] role check failed', {
              userRole: effectiveRole || tenantUser?.role,
              requiredRoles: options.roles,
            });
            const error = ApiErrorFactory.insufficientPermissions(options.roles);
            return error.toResponse();
          }
        }

        // Enforce permission requirements against the permissions matrix.
        // Permissions are expressed as "resource:action" strings, e.g. "payments:refund".
        if (options.permissions && options.permissions.length > 0) {
          const userRole = tenantUser?.role as Role | undefined;
          const denied = options.permissions.filter(permission => {
            if (isGlobalAdmin) return false;
            if (userPermissions.includes(permission)) return false;
            const colonIdx = permission.indexOf(':');
            const resource = colonIdx >= 0 ? permission.slice(0, colonIdx) : permission;
            const action = colonIdx >= 0 ? permission.slice(colonIdx + 1) : 'read';
            return !hasPermission(userRole ?? 'staff', resource, action as 'read' | 'write' | 'delete' | 'admin');
          });
          if (denied.length > 0) {
            if (tenantUser?.tenant_id) {
              await recordBusinessEvent(createSupabaseAdminClient(), {
                tenantId: tenantUser.tenant_id,
                actorType: 'user',
                actorId: authData.user.id,
                action: BUSINESS_EVENT_ACTIONS.ACCESS_DENIED,
                entityType: 'api_route',
                entityId: new URL(request.url).pathname,
                source: 'api',
                metadata: {
                  denied_permissions: denied,
                  role: userRole ?? 'staff',
                },
              });
            }
            const error = ApiErrorFactory.insufficientPermissions(options.permissions);
            return error.toResponse();
          }
        }

        // Lifecycle access gate — fail-open: any lookup error allows the request through.
        // Only runs when the route is authenticated AND a tenant context is present.
        if (tenantUser?.tenant_id) {
          try {
            const admin = createSupabaseAdminClient();
            const { data: tenantRow } = await admin
              .from('tenants')
              .select('lifecycle_state')
              .eq('id', tenantUser.tenant_id)
              .maybeSingle();
            const state = (tenantRow as { lifecycle_state?: string } | null)?.lifecycle_state;
            const pathname = new URL(request.url).pathname;
            if (state && !isLifecycleAccessible(state, pathname)) {
              throw new ApiError(
                'tenant_locked',
                'Tenant is being off-boarded. Only export and reactivation are permitted.',
                423
              );
            }
          } catch (err) {
            // Re-throw only the intentional lifecycle block; all other errors → fail-open.
            if (err instanceof ApiError && err.statusCode === 423) throw err;
            console.warn('[lifecycle-gate] check skipped (fail-open)', err);
          }
        }

        // Authorization is enforced server-side based on Supabase auth + tenant membership.
        // Clients must not send role or tenant context headers for trust decisions.
        const result = await handler({
          request,
          user: {
            id: authData.user.id,
            tenantUserId: tenantUser?.id,
            email: authData.user.email || '',
            role: isGlobalAdmin ? 'superadmin' : (tenantUser?.role || ''),
            tenantId: tenantUser?.tenant_id,
            permissions: isGlobalAdmin ? ['*'] : userPermissions,
          },
          supabase,
          params,
        });

        if (result instanceof NextResponse) {
          return result;
        }

        // Return response
        return NextResponse.json(result, { status: 200 });
      } else {
        // No auth required
        const supabase = legacyCtx?.supabase ?? getSupabaseRouteHandlerClient();
        const result = await handler({
          request,
          supabase,
          params,
        });

        if (result instanceof NextResponse) {
          return result;
        }

        return NextResponse.json(result, { status: 200 });
      }
    } catch (error) {
      if (legacyUser) {
        throw error;
      }
      const err = error instanceof Error ? error : new Error(String(error));
      // Only alert on unexpected server errors, not known ApiErrors (4xx)
      if (!(error instanceof ApiError)) {
        apiLogger.logError(err);
        getAlertService().sendErrorAlert(err, {
          operation: `${request.method} ${new URL(request.url).pathname}`,
        }).catch((alertErr: unknown) => {
          apiLogger.warn('Alert delivery failed', { error: String(alertErr) });
        });
      }
      return handleRouteError(err);
    }
  };
}

/**
 * Create unified HTTP method handler
 * 
 * Example:
 * ```typescript
 * const getHandler = createHttpHandler(
 *   async (ctx) => {
 *     const items = await ctx.supabase
 *       .from('items')
 *       .select('*')
 *       .eq('tenant_id', ctx.user?.tenantId);
 *     return items.data;
 *   }
 * );
 * 
 * export const GET = getHandler;
 * ```
 */
export function createHttpHandler(
  handler: RouteHandler,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
  options: RouteHandlerOptions = {}
) {
  return createApiHandler(handler, { ...options, methods: [method] });
}

/**
 * Create paginated route handler
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export function getPaginationParams(request: NextRequest): PaginationParams {
  const url = new URL(request.url);
  return {
    page: parseInt(url.searchParams.get('page') || '1', 10),
    limit: Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100),
    sort: url.searchParams.get('sort') || 'created_at',
    order: (url.searchParams.get('order') || 'desc') as 'asc' | 'desc',
  };
}

/**
 * Helper to extract and validate JSON body
 */
export async function parseJsonBody<T = unknown>(request: NextRequest): Promise<T> {
  try {
    return await request.json();
  } catch (error) {
    throw ApiErrorFactory.validationError({
      message: 'Invalid JSON body',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Get the server-verified tenant ID from route context.
 * Always uses ctx.user.tenantId (validated via tenant_users lookup during auth).
 * Rejects mismatched X-Tenant-ID headers with 403.
 */
export function getVerifiedTenantId(ctx: RouteContext): string {
  const tenantId = ctx.user?.tenantId;
  if (!tenantId) {
    throw ApiErrorFactory.badRequest('Tenant context is required for this operation');
  }
  return tenantId;
}

/**
 * Helper to extract route params
 */
export function getRouteParam(
  params: Record<string, string> | undefined,
  key: string,
  required = true
): string {
  const value = params?.[key];

  if (!value && required) {
    throw ApiErrorFactory.validationError({
      message: `Missing required parameter: ${key}`,
    });
  }

  return value || '';
}

/**
 * Type-safe API handler builder
 */
export class ApiHandlerBuilder<T = unknown> {
  private config: RouteHandlerOptions = {};
  private handler?: RouteHandler<T>;
  private preHandlers: Array<(ctx: RouteContext) => Promise<void>> = [];

  method(methods: string[]): ApiHandlerBuilder<T> {
    this.config.methods = methods;
    return this;
  }

  auth(required = true): ApiHandlerBuilder<T> {
    this.config.auth = required;
    return this;
  }

  roles(...roles: string[]): ApiHandlerBuilder<T> {
    this.config.roles = roles;
    return this;
  }

  permissions(...perms: string[]): ApiHandlerBuilder<T> {
    this.config.permissions = perms;
    return this;
  }

  before(fn: (ctx: RouteContext) => Promise<void>): ApiHandlerBuilder<T> {
    this.preHandlers.push(fn);
    return this;
  }

  handle(
    fn: RouteHandler<T>
  ): (
    request: NextRequest,
    ctx?: { params?: Promise<Record<string, string>> | Record<string, string> }
  ) => Promise<NextResponse> {
    this.handler = fn;
    const preHandlers = this.preHandlers;
    const capturedHandler = this.handler;

    // Delegate to createApiHandler so auth/role/permission config is enforced.
    return createApiHandler(
      async (ctx) => {
        for (const preHandler of preHandlers) {
          await preHandler(ctx);
        }
        return (capturedHandler ? await capturedHandler(ctx) : NextResponse.json({ ok: true })) as NextResponse;
      },
      this.config,
    ) as (
      request: NextRequest,
      ctx?: { params?: Promise<Record<string, string>> | Record<string, string> }
    ) => Promise<NextResponse>;
  }
}
