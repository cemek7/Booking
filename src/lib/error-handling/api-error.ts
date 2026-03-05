/**
 * UNIFIED ERROR HANDLING SYSTEM
 * 
 * Centralized error definitions, conversion, and response formatting
 * All API errors should use this system
 */

import { NextResponse } from 'next/server';

/**
 * API Error codes - Standardized across system
 */
export const ErrorCodes = {
  // Auth errors
  MISSING_AUTHORIZATION: 'missing_authorization',
  INVALID_TOKEN: 'invalid_token',
  TOKEN_EXPIRED: 'token_expired',
  INVALID_CREDENTIALS: 'invalid_credentials',
  SESSION_EXPIRED: 'session_expired',

  // Permission errors
  FORBIDDEN: 'forbidden',
  INSUFFICIENT_PERMISSIONS: 'insufficient_permissions',
  TENANT_MISMATCH: 'tenant_mismatch',
  ROLE_REQUIRED: 'role_required',

  // Validation errors
  VALIDATION_ERROR: 'validation_error',
  INVALID_REQUEST: 'invalid_request',
  MISSING_REQUIRED_FIELD: 'missing_required_field',

  // Resource errors
  NOT_FOUND: 'not_found',
  RESOURCE_NOT_FOUND: 'resource_not_found',
  CONFLICT: 'conflict',
  DUPLICATE_RESOURCE: 'duplicate_resource',

  // Business logic errors
  INVALID_STATE: 'invalid_state',
  OPERATION_NOT_ALLOWED: 'operation_not_allowed',
  INSUFFICIENT_BALANCE: 'insufficient_balance',
  QUOTA_EXCEEDED: 'quota_exceeded',

  // Server errors
  INTERNAL_SERVER_ERROR: 'internal_server_error',
  DATABASE_ERROR: 'database_error',
  EXTERNAL_SERVICE_ERROR: 'external_service_error',
  TIMEOUT: 'timeout',
} as const;

/**
 * HTTP status code mappings
 */
const StatusCodeMap: Record<string, number> = {
  [ErrorCodes.MISSING_AUTHORIZATION]: 401,
  [ErrorCodes.INVALID_TOKEN]: 401,
  [ErrorCodes.TOKEN_EXPIRED]: 401,
  [ErrorCodes.INVALID_CREDENTIALS]: 401,
  [ErrorCodes.SESSION_EXPIRED]: 401,

  [ErrorCodes.FORBIDDEN]: 403,
  [ErrorCodes.INSUFFICIENT_PERMISSIONS]: 403,
  [ErrorCodes.TENANT_MISMATCH]: 403,
  [ErrorCodes.ROLE_REQUIRED]: 403,

  [ErrorCodes.VALIDATION_ERROR]: 400,
  [ErrorCodes.INVALID_REQUEST]: 400,
  [ErrorCodes.MISSING_REQUIRED_FIELD]: 400,

  [ErrorCodes.NOT_FOUND]: 404,
  [ErrorCodes.RESOURCE_NOT_FOUND]: 404,

  [ErrorCodes.CONFLICT]: 409,
  [ErrorCodes.DUPLICATE_RESOURCE]: 409,

  [ErrorCodes.INVALID_STATE]: 422,
  [ErrorCodes.OPERATION_NOT_ALLOWED]: 422,
  [ErrorCodes.INSUFFICIENT_BALANCE]: 422,
  [ErrorCodes.QUOTA_EXCEEDED]: 429,

  [ErrorCodes.INTERNAL_SERVER_ERROR]: 500,
  [ErrorCodes.DATABASE_ERROR]: 500,
  [ErrorCodes.EXTERNAL_SERVICE_ERROR]: 502,
  [ErrorCodes.TIMEOUT]: 504,
};

/**
 * Error response structure
 */
export interface ApiErrorResponse {
  error: string;
  code: string;
  message: string;
  details?: Record<string, any>;
  traceId?: string;
  timestamp?: string;
}

/**
 * Unified API Error class
 */
export class ApiError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, any>;
  public readonly originalError?: Error;

  constructor(
    code: string,
    message: string,
    statusCode?: number,
    details?: Record<string, any>,
    originalError?: Error
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode || StatusCodeMap[code] || 500;
    this.details = details;
    this.originalError = originalError;

    // Maintain prototype chain
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /**
   * Convert to NextResponse
   */
  toResponse(includeDetails = false): NextResponse {
    const response: ApiErrorResponse = {
      error: this.code,
      code: this.code,
      message: this.message,
      timestamp: new Date().toISOString(),
    };

    if (includeDetails && this.details) {
      response.details = this.details;
    }

    return NextResponse.json(response, { status: this.statusCode });
  }

  /**
   * Convert to JSON object
   */
  toJSON(): ApiErrorResponse {
    return {
      error: this.code,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Error factory functions
 */
export const ApiErrorFactory = {
  missingAuthorization: () =>
    new ApiError(
      ErrorCodes.MISSING_AUTHORIZATION,
      'Authorization header is missing or malformed'
    ),

  invalidToken: (details?: Record<string, any>) =>
    new ApiError(
      ErrorCodes.INVALID_TOKEN,
      'Invalid or malformed token',
      undefined,
      details
    ),

  tokenExpired: () =>
    new ApiError(
      ErrorCodes.TOKEN_EXPIRED,
      'Token has expired'
    ),

  unauthorized: (message?: string) =>
    new ApiError(
      ErrorCodes.INVALID_TOKEN,
      message || 'Unauthorized',
      401
    ),

  forbidden: (reason?: string) =>
    new ApiError(
      ErrorCodes.FORBIDDEN,
      reason || 'Access denied'
    ),

  insufficientPermissions: (required?: string[]) =>
    new ApiError(
      ErrorCodes.INSUFFICIENT_PERMISSIONS,
      'Insufficient permissions for this operation',
      undefined,
      { required }
    ),

  tenantMismatch: () =>
    new ApiError(
      ErrorCodes.TENANT_MISMATCH,
      'Tenant mismatch: resource does not belong to your tenant'
    ),

  notFound: (resource: string) =>
    new ApiError(
      ErrorCodes.NOT_FOUND,
      `${resource} not found`
    ),

  badRequest: (message?: string) =>
    new ApiError(
      ErrorCodes.VALIDATION_ERROR,
      message || 'Bad request'
    ),

  validationError: (details: Record<string, any>) =>
    new ApiError(
      ErrorCodes.VALIDATION_ERROR,
      'Validation failed',
      undefined,
      details
    ),

  conflict: (message: string) =>
    new ApiError(
      ErrorCodes.CONFLICT,
      message
    ),

  internalServerError: (originalError?: Error) =>
    new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      'Internal server error occurred',
      500,
      undefined,
      originalError
    ),

  databaseError: (originalError?: Error) =>
    new ApiError(
      ErrorCodes.DATABASE_ERROR,
      'Database operation failed',
      500,
      undefined,
      originalError
    ),

  externalServiceError: (service: string, originalError?: Error) =>
    new ApiError(
      ErrorCodes.EXTERNAL_SERVICE_ERROR,
      `External service error: ${service}`,
      502,
      { service },
      originalError
    ),
};

/**
 * Error transformer - converts unknown errors to ApiError
 */
export function transformError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof Error) {
    // Try to detect error type from message
    const message = error.message.toLowerCase();

    if (message.includes('unauthorized') || message.includes('authentication')) {
      return ApiErrorFactory.invalidToken(undefined);
    }

    if (message.includes('forbidden') || message.includes('permission')) {
      return ApiErrorFactory.forbidden(error.message);
    }

    if (message.includes('not found')) {
      return ApiErrorFactory.notFound('Resource');
    }

    if (message.includes('validation')) {
      return ApiErrorFactory.validationError({ error: error.message });
    }

    if (message.includes('database') || message.includes('db')) {
      return ApiErrorFactory.databaseError(error);
    }

    // Default to internal server error
    return ApiErrorFactory.internalServerError(error);
  }

  // Unknown error type
  return ApiErrorFactory.internalServerError(
    new Error(String(error))
  );
}

/**
 * Error handler for middleware
 */
export async function handleMiddlewareError(
  error: Error,
  context?: { request?: { url: string } }
): Promise<NextResponse> {
  console.error('[Middleware Error]', {
    error: error.message,
    url: context?.request?.url,
    stack: error.stack,
  });

  const apiError = transformError(error);
  return apiError.toResponse(false);
}

/**
 * Error handler for API routes
 */
export async function handleRouteError(
  error: Error,
  includeDetails = false
): Promise<NextResponse> {
  console.error('[Route Error]', {
    error: error.message,
    stack: error.stack,
  });

  const apiError = transformError(error);
  return apiError.toResponse(includeDetails);
}
