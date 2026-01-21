/**
 * Service Logger
 *
 * Specialized logger for service layer and business logic
 */

import { Logger } from './index';
import type { LogContext, LogMetadata } from './types';

/**
 * Service-specific log metadata
 */
export interface ServiceLogMetadata extends LogMetadata {
  service?: string;
  operation?: string;
  entityId?: string;
  entityType?: string;
  duration?: number;
}

/**
 * Service Logger class with service-specific helpers
 */
export class ServiceLogger extends Logger {
  private serviceName: string;
  private operationStartTimes: Map<string, number>;

  constructor(serviceName: string, context?: LogContext) {
    super(context);
    this.serviceName = serviceName;
    this.operationStartTimes = new Map();
  }

  /**
   * Start timing an operation
   */
  startOperation(operationId: string): void {
    this.operationStartTimes.set(operationId, Date.now());
  }

  /**
   * End timing an operation and return duration
   */
  endOperation(operationId: string): number {
    const startTime = this.operationStartTimes.get(operationId);
    if (!startTime) return 0;

    const duration = Date.now() - startTime;
    this.operationStartTimes.delete(operationId);
    return duration;
  }

  /**
   * Log service operation start
   */
  logOperationStart(operation: string, metadata?: ServiceLogMetadata): void {
    this.startOperation(operation);

    this.info(`[${this.serviceName}] Starting ${operation}`, {
      service: this.serviceName,
      operation,
      ...metadata,
    });
  }

  /**
   * Log service operation success
   */
  logOperationSuccess(operation: string, metadata?: ServiceLogMetadata): void {
    const duration = this.endOperation(operation);

    this.info(`[${this.serviceName}] Completed ${operation}`, {
      service: this.serviceName,
      operation,
      duration,
      ...metadata,
    });
  }

  /**
   * Log service operation failure
   */
  logOperationFailure(operation: string, error: Error | string, metadata?: ServiceLogMetadata): void {
    const duration = this.endOperation(operation);

    this.error(`[${this.serviceName}] Failed ${operation}`, {
      service: this.serviceName,
      operation,
      error,
      duration,
      ...metadata,
    });
  }

  /**
   * Log database operation
   */
  logDatabaseOperation(operation: string, table: string, duration?: number, metadata?: LogMetadata): void {
    this.debug(`[${this.serviceName}] Database ${operation}`, {
      service: this.serviceName,
      operation: `db_${operation}`,
      entityType: table,
      duration,
      ...metadata,
    });
  }

  /**
   * Log cache operation
   */
  logCacheOperation(
    operation: 'hit' | 'miss' | 'set' | 'delete',
    key: string,
    metadata?: LogMetadata
  ): void {
    this.debug(`[${this.serviceName}] Cache ${operation}`, {
      service: this.serviceName,
      operation: `cache_${operation}`,
      cacheKey: key,
      ...metadata,
    });
  }

  /**
   * Log validation error
   */
  logValidationError(field: string, error: string, metadata?: ServiceLogMetadata): void {
    this.warn(`[${this.serviceName}] Validation error: ${field}`, {
      service: this.serviceName,
      operation: 'validation',
      field,
      error,
      ...metadata,
    });
  }

  /**
   * Log entity created
   */
  logEntityCreated(entityType: string, entityId: string, metadata?: ServiceLogMetadata): void {
    this.info(`[${this.serviceName}] Created ${entityType}`, {
      service: this.serviceName,
      operation: 'create',
      entityType,
      entityId,
      ...metadata,
    });
  }

  /**
   * Log entity updated
   */
  logEntityUpdated(entityType: string, entityId: string, metadata?: ServiceLogMetadata): void {
    this.info(`[${this.serviceName}] Updated ${entityType}`, {
      service: this.serviceName,
      operation: 'update',
      entityType,
      entityId,
      ...metadata,
    });
  }

  /**
   * Log entity deleted
   */
  logEntityDeleted(entityType: string, entityId: string, metadata?: ServiceLogMetadata): void {
    this.info(`[${this.serviceName}] Deleted ${entityType}`, {
      service: this.serviceName,
      operation: 'delete',
      entityType,
      entityId,
      ...metadata,
    });
  }
}

/**
 * Create service logger
 */
export function createServiceLogger(serviceName: string, context?: LogContext): ServiceLogger {
  return new ServiceLogger(serviceName, context);
}
