/**
 * Structured Logger
 *
 * Uses Winston in Node.js server context (lazy require so bundlers can
 * externalize it). Falls back to console in edge/browser runtimes where
 * Node.js `fs`-dependent packages are unavailable.
 */

import type { LogContext, LogMetadata, LogLevel } from './types';
import { redactAndTruncate } from '@/lib/pii';

// ---------------------------------------------------------------------------
// PII scrubbing — applied to all log metadata before writing
// ---------------------------------------------------------------------------
function scrubMetadata(obj: unknown): unknown {
  if (typeof obj === 'string') return redactAndTruncate(obj, 2000);
  if (Array.isArray(obj)) return obj.map(scrubMetadata);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, scrubMetadata(v)])
    );
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------
// `EdgeRuntime` global is defined by Next.js edge runtime and Cloudflare Workers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const EdgeRuntime: any;
const isEdge =
  typeof EdgeRuntime !== 'undefined' ||
  process.env.NEXT_RUNTIME === 'edge';

const isBrowser = typeof window !== 'undefined';

// Only use Winston when we are definitely in a Node.js server process.
const useWinston = !isEdge && !isBrowser;

// ---------------------------------------------------------------------------
// Minimal winston-compatible interface (used as the internal singleton type)
// ---------------------------------------------------------------------------
interface InternalLogger {
  error(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  http(message: string, meta?: unknown): void;
  debug(message: string, meta?: unknown): void;
  verbose(message: string, meta?: unknown): void;
  log(level: string, message: string, meta?: unknown): void;
}

// ---------------------------------------------------------------------------
// Console-based fallback (edge / browser)
// ---------------------------------------------------------------------------
const consoleLogger: InternalLogger = {
  error: (m, meta) => console.error(m, meta ?? ''),
  warn:  (m, meta) => console.warn(m, meta ?? ''),
  info:  (m, meta) => console.info(m, meta ?? ''),
  http:  (m, meta) => console.log(m, meta ?? ''),
  debug: (m, meta) => console.debug(m, meta ?? ''),
  verbose: (m, meta) => console.log(m, meta ?? ''),
  log: (level, m, meta) => console.log(`[${level}] ${m}`, meta ?? ''),
};

// ---------------------------------------------------------------------------
// Winston singleton (Node.js only, lazy)
// ---------------------------------------------------------------------------
let _winston: InternalLogger | null = null;

function buildWinstonLogger(): InternalLogger {
  // Dynamic require keeps the import out of edge/browser bundles even when
  // bundlers perform static analysis. `serverExternalPackages` in next.config.ts
  // ensures Turbopack never tries to bundle these in the first place.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const winston = require('winston');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DailyRotateFile = require('winston-daily-rotate-file');

  const isProduction = process.env.NODE_ENV === 'production';
  const isDevelopment = process.env.NODE_ENV === 'development';
  const { combine, timestamp, errors, json, printf, colorize } = winston.format;

  const devFormat = printf(({ level, message, timestamp, context, ...metadata }: {
    level: string;
    message: unknown;
    timestamp?: string;
    context?: { tenantId?: string; userId?: string; traceId?: string };
    [key: string]: unknown;
  }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (context?.tenantId) log += ` | tenant=${context.tenantId}`;
    if (context?.userId)   log += ` | user=${context.userId}`;
    if (context?.traceId)  log += ` | trace=${context.traceId}`;
    if (Object.keys(metadata).length > 0) log += ` | ${JSON.stringify(metadata)}`;
    return log;
  });

  const transports: import('winston').transport[] = [
    new winston.transports.Console({
      format: isDevelopment
        ? combine(colorize(), timestamp({ format: 'HH:mm:ss' }), devFormat)
        : combine(timestamp(), errors({ stack: true }), json()),
    }),
  ];

  if (isProduction) {
    transports.push(
      new DailyRotateFile({
        filename: 'logs/error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '20m',
        maxFiles: '14d',
        format: combine(timestamp(), errors({ stack: true }), json()),
      }),
      new DailyRotateFile({
        filename: 'logs/combined-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d',
        format: combine(timestamp(), errors({ stack: true }), json()),
      }),
      new DailyRotateFile({
        filename: 'logs/http-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'http',
        maxSize: '50m',
        maxFiles: '7d',
        format: combine(timestamp(), json()),
      }),
    );
  }

  return winston.createLogger({
    level: isDevelopment ? 'debug' : 'info',
    levels: winston.config.npm.levels,
    transports,
    exitOnError: false,
  });
}

function getLogger(): InternalLogger {
  if (!useWinston) return consoleLogger;
  if (!_winston) _winston = buildWinstonLogger();
  return _winston;
}

// ---------------------------------------------------------------------------
// Public Logger class (same API as before)
// ---------------------------------------------------------------------------
export class Logger {
  private context?: LogContext;

  constructor(context?: LogContext) {
    this.context = context;
  }

  withContext(additionalContext: LogContext): Logger {
    return new Logger({ ...this.context, ...additionalContext });
  }

  error(message: string, metadata?: unknown): void {
    getLogger().error(message, { context: this.context, ...this.spread(metadata) });
  }

  warn(message: string, metadata?: unknown): void {
    getLogger().warn(message, { context: this.context, ...this.spread(metadata) });
  }

  info(message: string, metadata?: unknown): void {
    getLogger().info(message, { context: this.context, ...this.spread(metadata) });
  }

  http(message: string, metadata?: unknown): void {
    getLogger().http(message, { context: this.context, ...this.spread(metadata) });
  }

  debug(message: string, metadata?: unknown): void {
    getLogger().debug(message, { context: this.context, ...this.spread(metadata) });
  }

  verbose(message: string, metadata?: unknown): void {
    getLogger().verbose(message, { context: this.context, ...this.spread(metadata) });
  }

  log(level: LogLevel, message: string, metadata?: unknown): void {
    getLogger().log(level, message, { context: this.context, ...this.spread(metadata) });
  }

  private spread(metadata: unknown): object {
    if (metadata === null || metadata === undefined) return {};
    const scrubbed = scrubMetadata(metadata);
    if (typeof scrubbed === 'object' && !Array.isArray(scrubbed)) return scrubbed as object;
    return { value: scrubbed };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
export const defaultLogger = new Logger();

export const log = {
  error:   (message: string, metadata?: unknown) => defaultLogger.error(message, metadata),
  warn:    (message: string, metadata?: unknown) => defaultLogger.warn(message, metadata),
  info:    (message: string, metadata?: unknown) => defaultLogger.info(message, metadata),
  http:    (message: string, metadata?: unknown) => defaultLogger.http(message, metadata),
  debug:   (message: string, metadata?: unknown) => defaultLogger.debug(message, metadata),
  verbose: (message: string, metadata?: unknown) => defaultLogger.verbose(message, metadata),
};

export type { LogContext, LogMetadata, LogLevel, LogEntry } from './types';
