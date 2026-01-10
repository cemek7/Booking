/**
 * MIDDLEWARE MIGRATION ADAPTER
 * 
 * Bridges existing middleware implementations to unified orchestrator
 * Allows gradual migration without breaking existing code
 * 
 * This file registers all existing middleware with the new system
 */

import { MiddlewareContext, MiddlewareHandler, middlewareOrchestrator } from './orchestrator';
import { NextResponse } from 'next/server';
import { ApiErrorFactory, handleMiddlewareError } from '@/lib/error-handling/api-error';
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { createAuthMiddleware, createRBACMiddleware, createTenantValidationMiddleware } from './auth/auth-handler';

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
        const publicPaths = ['/auth/', '/api/health', '/api/auth/'];
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

  // 4. HIPAA compliance middleware (PHI access logging)
  middlewareOrchestrator.register(
    {
      name: 'hipaa-compliance',
      enabled: process.env.HIPAA_ENABLED === 'true',
      priority: 50,
      condition: (ctx: MiddlewareContext) => {
        const pathname = new URL(ctx.request.url).pathname;
        // Apply to PHI endpoints (patient, medical records, etc.)
        const phiPaths = ['/api/patients', '/api/medical-records', '/api/health-data'];
        return phiPaths.some(p => pathname.startsWith(p));
      },
      errorHandler: async (error, context) => {
        console.error('[HIPAA] Compliance check failed:', error.message);
        return ApiErrorFactory.forbidden('HIPAA compliance check failed').toResponse();
      },
    },
    createHIPAAComplianceMiddleware()
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

  console.log('[Middleware] Unified middleware system initialized');
}

/**
 * HIPAA compliance middleware implementation
 */
function createHIPAAComplianceMiddleware(): MiddlewareHandler {
  return async (context: MiddlewareContext): Promise<MiddlewareContext | NextResponse> => {
    if (!context.user) {
      return context;
    }

    // Log PHI access for HIPAA compliance
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      userId: context.user.id,
      role: context.user.role,
      endpoint: new URL(context.request.url).pathname,
      method: context.request.method,
      ipAddress: context.request.headers.get('x-forwarded-for') || 'unknown',
    };

    console.log('[HIPAA] PHI Access Log:', JSON.stringify(logEntry));

    // Could integrate with external logging/monitoring here
    // e.g., send to compliance audit log

    context.state.hipaaLogged = true;
    return context;
  };
}

/**
 * Rate limiting middleware
 */
function createRateLimitingMiddleware(): MiddlewareHandler {
  // Simple in-memory rate limiter (would use Redis in production)
  const requestCounts = new Map<string, { count: number; resetTime: number }>();
  const WINDOW = 60000; // 1 minute
  const MAX_REQUESTS = 100;

  return async (context: MiddlewareContext): Promise<MiddlewareContext | NextResponse> => {
    const userId = context.user?.id || context.request.headers.get('x-forwarded-for') || 'anonymous';
    const now = Date.now();

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
      console.log(`[Request] ${context.request.method} ${url.pathname}`, {
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
export function registerLegacyMiddleware<T extends Record<string, any>>(
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
        console.error(`[Middleware] "${name}" error:`, error);
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
