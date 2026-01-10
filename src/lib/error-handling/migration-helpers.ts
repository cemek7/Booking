/**
 * MIGRATION UTILITIES FOR API ROUTES
 * 
 * Helper functions to simplify migration from old pattern to new unified system
 * Use these helpers when migrating routes that need special handling
 */

import { RouteContext } from './route-handler';
import { ApiErrorFactory } from './api-error';

/**
 * Extract and validate tenant ID from request
 * Supports multiple locations:
 * - Query parameter: ?tenant_id=...
 * - Route parameter: [tenantId]
 * - Request body: { tenant_id: ... }
 * - User context: ctx.user.tenantId
 */
export async function getTenantId(ctx: RouteContext): Promise<string> {
  // 1. Check route parameters
  if (ctx.params?.tenantId) {
    return ctx.params.tenantId;
  }

  // 2. Check query parameters
  const url = new URL(ctx.request.url);
  const queryTenantId = url.searchParams.get('tenant_id');
  if (queryTenantId) {
    return queryTenantId;
  }

  // 3. Check request body
  try {
    const body = await ctx.request.clone().json();
    if (body.tenant_id) {
      return body.tenant_id;
    }
  } catch {
    // Not JSON body, continue
  }

  // 4. Use user's tenant context
  if (ctx.user?.tenantId) {
    return ctx.user.tenantId;
  }

  throw ApiErrorFactory.validationError({
    message: 'tenant_id is required',
  });
}

/**
 * Extract resource ID from request
 * Supports multiple locations:
 * - Route parameter: [id]
 * - Query parameter: ?id=...
 * - Request body: { id: ... }
 */
export async function getResourceId(ctx: RouteContext, paramName = 'id'): Promise<string> {
  // 1. Check route parameters
  if (ctx.params?.[paramName]) {
    return ctx.params[paramName];
  }

  // 2. Check query parameters
  const url = new URL(ctx.request.url);
  const queryId = url.searchParams.get(paramName);
  if (queryId) {
    return queryId;
  }

  // 3. Check request body
  try {
    const body = await ctx.request.clone().json();
    if (body[paramName]) {
      return body[paramName];
    }
  } catch {
    // Not JSON body, continue
  }

  throw ApiErrorFactory.validationError({
    message: `${paramName} is required`,
  });
}

/**
 * Get pagination parameters with defaults
 */
export function getPaginationParams(ctx: RouteContext) {
  const url = new URL(ctx.request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)), 100);
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

/**
 * Verify resource ownership before modification
 */
export async function verifyOwnership(
  ctx: RouteContext,
  table: string,
  resourceId: string,
  userIdField = 'creator_id'
): Promise<boolean> {
  const { data, error } = await ctx.supabase
    .from(table)
    .select(userIdField)
    .eq('id', resourceId)
    .single();

  if (!data) {
    throw ApiErrorFactory.notFound(table);
  }

  if (data[userIdField] !== ctx.user?.id) {
    throw ApiErrorFactory.forbidden('You do not have permission to modify this resource');
  }

  return true;
}

/**
 * Verify tenant ownership of resource
 */
export async function verifyTenantOwnership(
  ctx: RouteContext,
  table: string,
  resourceId: string
): Promise<boolean> {
  const { data, error } = await ctx.supabase
    .from(table)
    .select('tenant_id')
    .eq('id', resourceId)
    .single();

  if (!data) {
    throw ApiErrorFactory.notFound(table);
  }

  if (data.tenant_id !== ctx.user?.tenantId) {
    throw ApiErrorFactory.tenantMismatch();
  }

  return true;
}

/**
 * Validate JSON body with schema
 */
export async function validateRequestBody<T = any>(
  ctx: RouteContext,
  schema?: (data: any) => Promise<T> | T
): Promise<T> {
  let body: any;

  try {
    body = await ctx.request.json();
  } catch (error) {
    throw ApiErrorFactory.validationError({
      message: 'Invalid JSON body',
    });
  }

  if (schema) {
    try {
      return await schema(body);
    } catch (error) {
      throw ApiErrorFactory.validationError({
        message: error instanceof Error ? error.message : 'Validation failed',
      });
    }
  }

  return body as T;
}

/**
 * Execute database operation with error handling
 */
export async function executeDb<T>(
  ctx: RouteContext,
  operation: (supabase: any) => Promise<{ data?: T; error?: any }>,
  errorMessage = 'Database operation failed'
): Promise<T> {
  try {
    const { data, error } = await operation(ctx.supabase);

    if (error) {
      // Handle specific database errors
      if (error.code === '23505') { // Unique constraint violation
        throw ApiErrorFactory.conflict(error.message);
      }
      if (error.code === '23503') { // Foreign key constraint violation
        throw ApiErrorFactory.validationError({ message: 'Invalid reference' });
      }
      if (error.code === '23502') { // Not null constraint violation
        throw ApiErrorFactory.validationError({ message: 'Missing required field' });
      }

      throw ApiErrorFactory.databaseError(error);
    }

    if (!data) {
      throw ApiErrorFactory.notFound('Resource');
    }

    return data;
  } catch (error) {
    if (error instanceof ApiErrorFactory.constructor.prototype.constructor) {
      throw error;
    }
    throw ApiErrorFactory.databaseError(
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Perform database transaction
 */
export async function transaction<T>(
  ctx: RouteContext,
  handler: (supabase: any) => Promise<T>
): Promise<T> {
  try {
    // Note: Supabase doesn't support transactions in client mode
    // This is a placeholder for when transaction support is added
    return await handler(ctx.supabase);
  } catch (error) {
    if (error instanceof ApiErrorFactory.constructor.prototype.constructor) {
      throw error;
    }
    throw ApiErrorFactory.internalServerError(
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Create paginated response
 */
export function createPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
) {
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      hasMore: page < Math.ceil(total / limit),
    },
  };
}

/**
 * Handle superadmin audit logging
 */
export async function auditSuperadminAction(
  ctx: RouteContext,
  action: string,
  details: Record<string, any>
) {
  try {
    // Log to audit table
    await ctx.supabase
      .from('superadmin_audit_log')
      .insert({
        admin_id: ctx.user?.id,
        admin_email: ctx.user?.email,
        action,
        details,
        timestamp: new Date().toISOString(),
        ip_address: ctx.request.headers.get('x-forwarded-for'),
      });
  } catch (error) {
    console.error('[Audit] Failed to log action:', error);
    // Don't throw - audit logging shouldn't block operation
  }
}

/**
 * Rate limit check (simple in-memory)
 */
const rateLimitMap = new Map<string, { count: number; reset: number }>();

export function checkRateLimit(
  identifier: string,
  limit = 100,
  windowMs = 60000
): { allowed: boolean; remaining: number; reset: number } {
  const now = Date.now();
  const record = rateLimitMap.get(identifier);

  if (!record || now > record.reset) {
    const newRecord = { count: 1, reset: now + windowMs };
    rateLimitMap.set(identifier, newRecord);
    return { allowed: true, remaining: limit - 1, reset: newRecord.reset };
  }

  record.count++;
  const remaining = Math.max(0, limit - record.count);

  return {
    allowed: record.count <= limit,
    remaining,
    reset: record.reset,
  };
}

/**
 * Create etag from object
 */
export function createEtag(data: any): string {
  const hash = require('crypto')
    .createHash('md5')
    .update(JSON.stringify(data))
    .digest('hex');
  return `"${hash}"`;
}

/**
 * Check if etag matches (for conditional requests)
 */
export function etagMatches(etag: string | null, current: string): boolean {
  return etag === current;
}
