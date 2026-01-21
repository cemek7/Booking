/**
 * API Logger
 *
 * Specialized logger for API routes with automatic context extraction
 * and HTTP-specific metadata
 */

import { NextRequest } from 'next/server';
import { Logger } from './index';
import { extractContextFromRequest } from './context';
import type { LogContext, LogMetadata } from './types';

/**
 * API-specific log metadata
 */
export interface ApiLogMetadata extends LogMetadata {
  method?: string;
  path?: string;
  statusCode?: number;
  duration?: number;
  userAgent?: string;
  ip?: string;
  query?: Record<string, string>;
}

/**
 * API Logger class with request-specific helpers
 */
export class ApiLogger extends Logger {
  private requestStartTime?: number;
  private request?: NextRequest;

  constructor(request?: NextRequest, context?: LogContext) {
    // Extract context from request if provided
    const requestContext = request ? extractContextFromRequest(request) : {};
    super({ ...requestContext, ...context });

    this.request = request;
    this.requestStartTime = Date.now();
  }

  /**
   * Log API request start
   */
  logRequest(metadata?: ApiLogMetadata): void {
    if (!this.request) {
      this.http('API Request', metadata);
      return;
    }

    const { method, url } = this.request;
    const { pathname, searchParams } = new URL(url);

    this.http(`${method} ${pathname}`, {
      method,
      path: pathname,
      query: Object.fromEntries(searchParams),
      userAgent: this.request.headers.get('user-agent') || undefined,
      ip: this.request.headers.get('x-forwarded-for') || this.request.headers.get('x-real-ip') || undefined,
      ...metadata,
    });
  }

  /**
   * Log API response
   */
  logResponse(statusCode: number, metadata?: ApiLogMetadata): void {
    const duration = this.requestStartTime ? Date.now() - this.requestStartTime : undefined;

    if (!this.request) {
      this.http('API Response', { statusCode, duration, ...metadata });
      return;
    }

    const { method, url } = this.request;
    const { pathname } = new URL(url);

    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'http';

    this.log(level, `${method} ${pathname} ${statusCode}`, {
      method,
      path: pathname,
      statusCode,
      duration,
      ...metadata,
    });
  }

  /**
   * Log API error
   */
  logError(error: Error | string, metadata?: ApiLogMetadata): void {
    const duration = this.requestStartTime ? Date.now() - this.requestStartTime : undefined;

    if (!this.request) {
      this.error(typeof error === 'string' ? error : error.message, {
        error,
        duration,
        ...metadata,
      });
      return;
    }

    const { method, url } = this.request;
    const { pathname } = new URL(url);

    this.error(`${method} ${pathname} failed`, {
      method,
      path: pathname,
      error,
      duration,
      ...metadata,
    });
  }

  /**
   * Log database query
   */
  logQuery(query: string, duration?: number, metadata?: LogMetadata): void {
    this.debug('Database query', {
      operation: 'db_query',
      query: query.length > 200 ? query.substring(0, 200) + '...' : query,
      duration,
      ...metadata,
    });
  }

  /**
   * Log external API call
   */
  logExternalCall(service: string, endpoint: string, duration?: number, metadata?: LogMetadata): void {
    this.debug(`External API call to ${service}`, {
      operation: 'external_api_call',
      service,
      endpoint,
      duration,
      ...metadata,
    });
  }
}

/**
 * Create API logger from Next.js request
 */
export function createApiLogger(request?: NextRequest, context?: LogContext): ApiLogger {
  return new ApiLogger(request, context);
}

/**
 * Middleware helper to add logger to request
 * Usage in middleware: req.logger = createRequestLogger(req)
 */
export function createRequestLogger(req: NextRequest): ApiLogger {
  return new ApiLogger(req);
}
