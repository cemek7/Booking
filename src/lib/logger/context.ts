/**
 * Logger Context Helpers
 *
 * Utilities for extracting and managing logging context
 */

import { NextRequest } from 'next/server';
import type { LogContext } from './types';

/**
 * Extract logging context from Next.js request
 */
export function extractContextFromRequest(req: NextRequest): LogContext {
  const context: LogContext = {};

  // Extract tenant ID from header
  const tenantId = req.headers.get('x-tenant-id');
  if (tenantId) {
    context.tenantId = tenantId;
  }

  // Extract user ID from header (set by auth middleware)
  const userId = req.headers.get('x-user-id');
  if (userId) {
    context.userId = userId;
  }

  // Extract trace ID (from OpenTelemetry or custom header)
  const traceId = req.headers.get('x-trace-id') || req.headers.get('traceparent');
  if (traceId) {
    context.traceId = traceId;
  }

  // Generate request ID if not present
  const requestId = req.headers.get('x-request-id') || generateRequestId();
  context.requestId = requestId;

  // Extract session ID from cookies or headers
  const sessionId = req.cookies.get('session-id')?.value || req.headers.get('x-session-id');
  if (sessionId) {
    context.sessionId = sessionId;
  }

  return context;
}

/**
 * Extract context from server component request
 * (Used in server components where NextRequest is not available)
 */
export function extractContextFromHeaders(headers: Headers): LogContext {
  const context: LogContext = {};

  // Extract tenant ID
  const tenantId = headers.get('x-tenant-id');
  if (tenantId) {
    context.tenantId = tenantId;
  }

  // Extract user ID
  const userId = headers.get('x-user-id');
  if (userId) {
    context.userId = userId;
  }

  // Extract trace ID
  const traceId = headers.get('x-trace-id') || headers.get('traceparent');
  if (traceId) {
    context.traceId = traceId;
  }

  // Extract request ID
  const requestId = headers.get('x-request-id');
  if (requestId) {
    context.requestId = requestId;
  }

  return context;
}

/**
 * Merge multiple log contexts
 */
export function mergeContexts(...contexts: (LogContext | undefined)[]): LogContext {
  return contexts.reduce((merged, ctx) => {
    if (!ctx) return merged;
    return { ...merged, ...ctx };
  }, {} as LogContext);
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sanitize context to remove sensitive information
 */
export function sanitizeContext(context: LogContext): LogContext {
  const sanitized = { ...context };

  // Remove any potential PII or sensitive fields
  const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'creditCard'];

  for (const key of Object.keys(sanitized)) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    }
  }

  return sanitized;
}
