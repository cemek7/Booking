/**
 * UNIFIED MIDDLEWARE SYSTEM
 * 
 * Central orchestration for all Next.js middleware
 * Provides composable, reusable middleware chain
 * 
 * Features:
 * - Middleware composition and chaining
 * - Conditional middleware application
 * - Error boundary handling
 * - Request/response decoration
 * - Type-safe middleware definitions
 */

import { NextRequest, NextResponse } from 'next/server';

/**
 * Middleware context passed through the chain
 */
export interface MiddlewareContext {
  request: NextRequest;
  response?: NextResponse;
  state: Record<string, any>;
  user?: {
    id: string;
    email: string;
    role: string;
    tenantId?: string;
    permissions?: string[];
  };
  error?: {
    code: string;
    message: string;
    statusCode: number;
  };
}

/**
 * Middleware handler function signature
 */
export type MiddlewareHandler = (
  context: MiddlewareContext
) => Promise<MiddlewareContext | NextResponse>;

/**
 * Middleware configuration
 */
export interface MiddlewareConfig {
  name: string;
  enabled: boolean;
  condition?: (context: MiddlewareContext) => boolean;
  priority: number; // Higher numbers run first
  errorHandler?: (error: Error, context: MiddlewareContext) => Promise<NextResponse>;
}

/**
 * Registered middleware entry
 */
interface RegisteredMiddleware {
  config: MiddlewareConfig;
  handler: MiddlewareHandler;
}

/**
 * Unified Middleware System
 * Central orchestration for all middleware
 */
export class MiddlewareOrchestrator {
  private middlewares: RegisteredMiddleware[] = [];
  private static instance: MiddlewareOrchestrator;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): MiddlewareOrchestrator {
    if (!MiddlewareOrchestrator.instance) {
      MiddlewareOrchestrator.instance = new MiddlewareOrchestrator();
    }
    return MiddlewareOrchestrator.instance;
  }

  /**
   * Register a middleware
   */
  register(
    config: MiddlewareConfig,
    handler: MiddlewareHandler
  ): MiddlewareOrchestrator {
    if (this.middlewares.some(m => m.config.name === config.name)) {
      throw new Error(`Middleware "${config.name}" already registered`);
    }

    this.middlewares.push({ config, handler });
    
    // Sort by priority (higher first)
    this.middlewares.sort((a, b) => b.config.priority - a.config.priority);

    return this;
  }

  /**
   * Unregister a middleware
   */
  unregister(name: string): MiddlewareOrchestrator {
    this.middlewares = this.middlewares.filter(m => m.config.name !== name);
    return this;
  }

  /**
   * Get registered middleware
   */
  getMiddleware(name: string): RegisteredMiddleware | undefined {
    return this.middlewares.find(m => m.config.name === name);
  }

  /**
   * Get all registered middleware
   */
  getAll(): RegisteredMiddleware[] {
    return [...this.middlewares];
  }

  /**
   * Execute middleware chain
   */
  async execute(request: NextRequest): Promise<NextResponse> {
    const context: MiddlewareContext = {
      request,
      state: {},
    };

    for (const middleware of this.middlewares) {
      try {
        // Check if middleware is enabled
        if (!middleware.config.enabled) {
          continue;
        }

        // Check conditional execution
        if (middleware.config.condition && !middleware.config.condition(context)) {
          continue;
        }

        // Execute middleware
        const result = await middleware.handler(context);

        // If middleware returned a NextResponse, return immediately
        if (result instanceof NextResponse) {
          return result;
        }

        // Update context with result
        Object.assign(context, result);
      } catch (error) {
        console.error(`[Middleware] "${middleware.config.name}" error:`, error);

        // Use middleware-specific error handler if available
        if (middleware.config.errorHandler) {
          try {
            return await middleware.config.errorHandler(
              error instanceof Error ? error : new Error(String(error)),
              context
            );
          } catch (handlerError) {
            console.error(`[Middleware] Error handler for "${middleware.config.name}" failed:`, handlerError);
          }
        }

        // Return 500 if unhandled error
        return NextResponse.json(
          { error: 'Internal Server Error', middleware: middleware.config.name },
          { status: 500 }
        );
      }
    }

    // If no middleware returned a response, return 200 OK
    if (!context.response) {
      context.response = NextResponse.next();
    }

    return context.response;
  }

  /**
   * Clear all middleware
   */
  clear(): MiddlewareOrchestrator {
    this.middlewares = [];
    return this;
  }
}

/**
 * Helper factory to create route middleware executor
 */
export function createRouteMiddleware(handlers: MiddlewareHandler[]) {
  return async (request: NextRequest): Promise<MiddlewareContext> => {
    const context: MiddlewareContext = {
      request,
      state: {},
    };

    for (const handler of handlers) {
      const result = await handler(context);
      if (result instanceof NextResponse) {
        throw new Error('Route middleware should not return NextResponse');
      }
      Object.assign(context, result);
    }

    return context;
  };
}

/**
 * Helper to create conditional middleware
 */
export function createConditionalMiddleware(
  condition: (req: NextRequest) => boolean,
  handler: MiddlewareHandler
): MiddlewareHandler {
  return async (context: MiddlewareContext) => {
    if (condition(context.request)) {
      return handler(context);
    }
    return context;
  };
}

/**
 * Helper to create error-aware middleware
 */
export function createErrorAwareMiddleware(
  handler: MiddlewareHandler,
  onError?: (error: Error, context: MiddlewareContext) => Promise<MiddlewareContext | NextResponse>
): MiddlewareHandler {
  return async (context: MiddlewareContext) => {
    try {
      return await handler(context);
    } catch (error) {
      if (onError) {
        return onError(
          error instanceof Error ? error : new Error(String(error)),
          context
        );
      }
      throw error;
    }
  };
}

// Export singleton
export const middlewareOrchestrator = MiddlewareOrchestrator.getInstance();
