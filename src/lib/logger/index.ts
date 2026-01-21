/**
 * Structured Logger
 *
 * Winston-based structured logging with OpenTelemetry integration
 * Replaces console.log/error/warn throughout the application
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import type { LogContext, LogMetadata, LogLevel } from './types';

const { combine, timestamp, errors, json, printf, colorize } = winston.format;

// Determine if we're in production
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * Custom format for development console output
 */
const devFormat = printf(({ level, message, timestamp, context, ...metadata }) => {
  let log = `${timestamp} [${level}]: ${message}`;

  if (context?.tenantId) log += ` | tenant=${context.tenantId}`;
  if (context?.userId) log += ` | user=${context.userId}`;
  if (context?.traceId) log += ` | trace=${context.traceId}`;

  if (Object.keys(metadata).length > 0) {
    log += ` | ${JSON.stringify(metadata)}`;
  }

  return log;
});

/**
 * Create Winston logger instance
 */
const createLogger = () => {
  const transports: winston.transport[] = [];

  // Console transport (always enabled)
  transports.push(
    new winston.transports.Console({
      format: isDevelopment
        ? combine(
            colorize(),
            timestamp({ format: 'HH:mm:ss' }),
            devFormat
          )
        : combine(
            timestamp(),
            errors({ stack: true }),
            json()
          ),
    })
  );

  // File transport for production
  if (isProduction) {
    // Error logs - separate file
    transports.push(
      new DailyRotateFile({
        filename: 'logs/error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '20m',
        maxFiles: '14d',
        format: combine(timestamp(), errors({ stack: true }), json()),
      })
    );

    // Combined logs - all levels
    transports.push(
      new DailyRotateFile({
        filename: 'logs/combined-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d',
        format: combine(timestamp(), errors({ stack: true }), json()),
      })
    );

    // HTTP logs - API requests
    transports.push(
      new DailyRotateFile({
        filename: 'logs/http-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'http',
        maxSize: '50m',
        maxFiles: '7d',
        format: combine(timestamp(), json()),
      })
    );
  }

  return winston.createLogger({
    level: isDevelopment ? 'debug' : 'info',
    levels: winston.config.npm.levels,
    transports,
    exitOnError: false,
  });
};

// Create singleton logger instance
const logger = createLogger();

/**
 * Logger class with context support
 */
export class Logger {
  private context?: LogContext;

  constructor(context?: LogContext) {
    this.context = context;
  }

  /**
   * Create a child logger with additional context
   */
  withContext(additionalContext: LogContext): Logger {
    return new Logger({
      ...this.context,
      ...additionalContext,
    });
  }

  /**
   * Log an error
   */
  error(message: string, metadata?: LogMetadata): void {
    logger.error(message, {
      context: this.context,
      ...metadata,
    });
  }

  /**
   * Log a warning
   */
  warn(message: string, metadata?: LogMetadata): void {
    logger.warn(message, {
      context: this.context,
      ...metadata,
    });
  }

  /**
   * Log info
   */
  info(message: string, metadata?: LogMetadata): void {
    logger.info(message, {
      context: this.context,
      ...metadata,
    });
  }

  /**
   * Log HTTP request/response
   */
  http(message: string, metadata?: LogMetadata): void {
    logger.http(message, {
      context: this.context,
      ...metadata,
    });
  }

  /**
   * Log debug information
   */
  debug(message: string, metadata?: LogMetadata): void {
    logger.debug(message, {
      context: this.context,
      ...metadata,
    });
  }

  /**
   * Log verbose information
   */
  verbose(message: string, metadata?: LogMetadata): void {
    logger.verbose(message, {
      context: this.context,
      ...metadata,
    });
  }

  /**
   * Generic log method with level parameter
   */
  log(level: LogLevel, message: string, metadata?: LogMetadata): void {
    logger.log(level, message, {
      context: this.context,
      ...metadata,
    });
  }
}

// Export default logger instance
export const defaultLogger = new Logger();

// Export convenience methods
export const log = {
  error: (message: string, metadata?: LogMetadata) => defaultLogger.error(message, metadata),
  warn: (message: string, metadata?: LogMetadata) => defaultLogger.warn(message, metadata),
  info: (message: string, metadata?: LogMetadata) => defaultLogger.info(message, metadata),
  http: (message: string, metadata?: LogMetadata) => defaultLogger.http(message, metadata),
  debug: (message: string, metadata?: LogMetadata) => defaultLogger.debug(message, metadata),
  verbose: (message: string, metadata?: LogMetadata) => defaultLogger.verbose(message, metadata),
};

// Export types
export type { LogContext, LogMetadata, LogLevel, LogEntry } from './types';
