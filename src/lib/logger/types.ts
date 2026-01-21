/**
 * Logger Types
 *
 * Type definitions for the structured logging system
 */

export interface LogContext {
  /**
   * Tenant ID for multi-tenant isolation
   */
  tenantId?: string;

  /**
   * User ID for user-scoped logging
   */
  userId?: string;

  /**
   * OpenTelemetry trace ID for distributed tracing correlation
   */
  traceId?: string;

  /**
   * Request ID for tracking individual HTTP requests
   */
  requestId?: string;

  /**
   * Session ID for tracking user sessions
   */
  sessionId?: string;

  /**
   * Additional custom metadata
   */
  [key: string]: string | number | boolean | undefined;
}

export interface LogMetadata {
  /**
   * The operation being performed
   */
  operation?: string;

  /**
   * Duration of the operation in milliseconds
   */
  duration?: number;

  /**
   * HTTP status code (for API requests)
   */
  statusCode?: number;

  /**
   * Error object if operation failed
   */
  error?: Error | string;

  /**
   * Additional structured data
   */
  [key: string]: unknown;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'http' | 'debug' | 'verbose';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
  metadata?: LogMetadata;
}
