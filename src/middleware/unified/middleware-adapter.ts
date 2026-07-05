/**
 * MIDDLEWARE MIGRATION ADAPTER
 * 
 * Bridges existing middleware implementations to unified orchestrator
 * Allows gradual migration without breaking existing code
 * 
 * This file registers all existing middleware with the new system
 */

import { defaultLogger } from '@/lib/logger';
import { MiddlewareContext, MiddlewareHandler, middlewareOrchestrator } from './orchestrator';
import { NextResponse } from 'next/server';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createAuthMiddleware, createTenantValidationMiddleware } from './auth/auth-handler';
import { cacheGet, cacheSet, isRedisFeatureEnabled } from '@/lib/redis';

/**
 * Initialize all middleware in the orchestrator
 * Call this once during application startup
 */
export async function initializeUnifiedMiddleware() {
  // 1. Authentication middleware (handles token validation, user context)
  middlewareOrchestrator.register(
    {
      name: 'auth',
      enabled: true,
      priority: 100, // Runs first
      condition: (ctx: MiddlewareContext) => {
        const pathname = new URL(ctx.request.url).pathname;
        // Skip auth for public paths
        const publicPaths = ['/auth/', '/api/health', '/api/auth/', '/book/', '/booka', '/products', '/reviews/'];
        // Root page is public — unauthenticated landing / hash-redirect handler
        if (pathname === '/') return false;
        return !publicPaths.some(p => pathname.startsWith(p));
      },
    },
    createAuthMiddleware({ required: true })
  );

  // 2. RBAC middleware (DISABLED - frontend owns all role logic)
  // Middleware only verifies authentication now, role-based access is handled by frontend
  // middlewareOrchestrator.register(
  //   {
  //     name: 'rbac',
  //     enabled: false,
  //     priority: 90,
  //     condition: (ctx: MiddlewareContext) => {
  //       return !!ctx.user;
  //     },
  //   },
  //   createRBACMiddleware(['owner', 'manager', 'staff', 'superadmin'])
  // );

  // 3. Tenant validation middleware
  middlewareOrchestrator.register(
    {
      name: 'tenant-validation',
      enabled: true,
      priority: 80,
      condition: (ctx: MiddlewareContext) => {
        const pathname = new URL(ctx.request.url).pathname;
        // Apply to tenant-specific routes
        return pathname.includes('/api/') && !!ctx.user;
      },
    },
    createTenantValidationMiddleware()
  );

  // 5. Rate limiting middleware
  middlewareOrchestrator.register(
    {
      name: 'rate-limiting',
      enabled: true,
      priority: 70,
    },
    createRateLimitingMiddleware()
  );

  // 6. Request logging middleware
  middlewareOrchestrator.register(
    {
      name: 'logging',
      enabled: true,
      priority: 110, // Runs early to capture all requests
    },
    createLoggingMiddleware()
  );

  defaultLogger.info('[Middleware] Unified middleware system initialized');
}


/**
 * Rate limiting middleware
 */
function createRateLimitingMiddleware(): MiddlewareHandler {
  const requestCounts = new Map<string, { count: number; resetTime: number }>();
  const WINDOW = 60000; // 1 minute
  const MAX_REQUESTS = 100;

  return async (context: MiddlewareContext): Promise<MiddlewareContext | NextResponse> => {
    const userId = context.user?.id || context.request.headers.get('x-forwarded-for') || 'anonymous';
    const cacheKey = `middleware_rate_limit:${userId}`;
    const now = Date.now();

    if (isRedisFeatureEnabled()) {
      try {
        const current = (await cacheGet(cacheKey)) as { count: number; resetTime: number } | null;
        const record = current && now <= current.resetTime ? current : null;
        const nextRecord = record
          ? { count: record.count + 1, resetTime: record.resetTime }
          : { count: 1, resetTime: now + WINDOW };

        if (nextRecord.count > MAX_REQUESTS) {
          return NextResponse.json(
            { error: 'too_many_requests', message: 'Rate limit exceeded' },
            { status: 429 }
          );
        }

        await cacheSet(cacheKey, nextRecord, Math.max(1, Math.ceil((nextRecord.resetTime - now) / 1000)));
        context.state.rateLimitRemaining = MAX_REQUESTS - nextRecord.count;
        return context;
      } catch (error) {
        defaultLogger.error('[Middleware] Redis rate limiter failed', error);
        if (process.env.NODE_ENV === 'production') {
          return NextResponse.json(
            { error: 'service_unavailable', message: 'Redis-backed rate limiting is required in production' },
            { status: 503 }
          );
        }
      }
    }

    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'service_unavailable', message: 'Redis-backed rate limiting is required in production' },
        { status: 503 }
      );
    }

    const record = requestCounts.get(userId);
    if (!record || now > record.resetTime) {
      requestCounts.set(userId, { count: 1, resetTime: now + WINDOW });
      return context;
    }

    record.count++;
    if (record.count > MAX_REQUESTS) {
      return NextResponse.json(
        { error: 'too_many_requests', message: 'Rate limit exceeded' },
        { status: 429 }
      );
    }

    context.state.rateLimitRemaining = MAX_REQUESTS - record.count;
    return context;
  };
}

/**
 * Request logging middleware
 */
function createLoggingMiddleware(): MiddlewareHandler {
  return async (context: MiddlewareContext): Promise<MiddlewareContext> => {
    const url = new URL(context.request.url);
    const startTime = Date.now();

    // Store for later use
    context.state.startTime = startTime;
    context.state.pathname = url.pathname;

    // Log request
    if (process.env.LOG_REQUESTS === 'true') {
      defaultLogger.info(`[Request] ${context.request.method} ${url.pathname}`, {
        userId: context.user?.id,
        role: context.user?.role,
      });
    }

    return context;
  };
}

/**
 * Register legacy middleware for backwards compatibility
 * 
 * Use this to wrap existing middleware functions into the new system
 */
export function registerLegacyMiddleware<T extends Record<string, unknown>>(
  name: string,
  handler: (ctx: T) => Promise<void | NextResponse>,
  options = {}
): void {
  middlewareOrchestrator.register(
    {
      name,
      enabled: true,
      priority: 0,
      ...options,
    },
    async (context: MiddlewareContext): Promise<MiddlewareContext | NextResponse> => {
      try {
        const result = await handler(context as unknown as T);
        if (result instanceof NextResponse) {
          return result;
        }
        return context;
      } catch (error) {
        defaultLogger.error(`[Middleware] "${name}" error:`, error);
        return ApiErrorFactory.internalServerError(
          error instanceof Error ? error : undefined
        ).toResponse();
      }
    }
  );
}

/**
 * Export for testing
 */
export const MIDDLEWARE_INITIALIZATION = initializeUnifiedMiddleware;
