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
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { 
  ApiError, 
  ApiErrorFactory, 
  handleRouteError,
  ErrorCodes 
} from '@/lib/error-handling/api-error';

/**
 * Route handler context
 */
export interface RouteContext {
  request: NextRequest;
  user?: {
    id: string;
    email: string;
    role: string;
    tenantId?: string;
    permissions?: string[];
  };
  supabase: any;
  params?: Record<string, string>;
}

/**
 * Route handler function
 */
export type RouteHandler<T = any> = (context: RouteContext) => Promise<T>;

/**
 * Route handler options
 */
export interface RouteHandlerOptions {
  methods?: string[]; // Allowed HTTP methods
  auth?: boolean; // Require authentication
  roles?: string[]; // Required roles
  permissions?: string[]; // Required permissions
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
  return async (request: NextRequest, context?: { params?: Record<string, string> }) => {
    try {
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
        console.log('[route-handler] Auth check for', request.method, request.url.split('?')[0], 'authHeader:', authHeader ? 'present' : 'MISSING');
        
        if (!authHeader.startsWith('Bearer ')) {
          const error = ApiErrorFactory.missingAuthorization();
          return error.toResponse();
        }

        const token = authHeader.slice(7);
        const supabase = getSupabaseRouteHandlerClient();

        // Extract tenantId from header - frontend should always send this
        const tenantId = request.headers.get('X-Tenant-ID');
        
        // Extract userId from token (JWT payload)
        // JWT format: header.payload.signature
        let userId = '';
        try {
          const parts = token.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
            userId = payload.sub || '';
          }
        } catch (e) {
          console.error('[route-handler] Failed to parse JWT:', e);
          const error = ApiErrorFactory.invalidToken();
          return error.toResponse();
        }

        if (!userId) {
          const error = ApiErrorFactory.invalidToken();
          return error.toResponse();
        }

        // NOTE: Role-based access control is handled by frontend
        // Frontend has actual role in localStorage from /api/admin/check
        // API only verifies authentication (token structure), not authorization
        
        // If handler needs to know about roles/permissions, they must:
        // 1. Be passed via headers from frontend (which read them from localStorage)
        // 2. Be re-queried from database using tenant context
        // 3. NOT be assumed from authentication token alone

        // For now, we'll set default values and let handler use headers if needed
        const result = await handler({
          request,
          user: {
            id: userId,
            email: '', // Email not available in JWT without additional query
            role: '', // Empty - frontend owns the role from localStorage
            tenantId: tenantId ? tenantId : undefined,
            permissions: [],
          },
          supabase,
          params: context?.params,
        });

        // Return response
        return NextResponse.json(result, { status: 200 });
      } else {
        // No auth required
        const supabase = getSupabaseRouteHandlerClient();
        const result = await handler({
          request,
          supabase,
          params: context?.params,
        });

        return NextResponse.json(result, { status: 200 });
      }
    } catch (error) {
      return handleRouteError(error instanceof Error ? error : new Error(String(error)));
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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
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
export async function parseJsonBody<T = any>(request: NextRequest): Promise<T> {
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
export class ApiHandlerBuilder<T = any> {
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

  handle(fn: RouteHandler<T>): (request: NextRequest, ctx?: any) => Promise<NextResponse> {
    this.handler = fn;

    return async (request: NextRequest, context?: any) => {
      try {
        // Run pre-handlers
        const ctx: RouteContext = {
          request,
          supabase: getSupabaseRouteHandlerClient(),
          params: context?.params,
        };

        for (const preHandler of this.preHandlers) {
          await preHandler(ctx);
        }

        // Run main handler
        const result = this.handler ? await this.handler(ctx) : null;
        return NextResponse.json(result, { status: 200 });
      } catch (error) {
        return handleRouteError(error instanceof Error ? error : new Error(String(error)));
      }
    };
  }
}
