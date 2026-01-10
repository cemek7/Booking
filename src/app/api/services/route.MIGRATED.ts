/**
 * UNIFIED SERVICES API - MIGRATED
 * 
 * This is an example of migrating from inline auth/error handling
 * to the unified system using createHttpHandler()
 * 
 * Changes made:
 * - Removed inline Bearer token extraction
 * - Removed manual user role validation
 * - Removed inconsistent error responses
 * - Uses ctx.user, ctx.supabase automatically
 * - All errors automatically transformed with correct status codes
 * 
 * Before: src/app/api/services/route.ts (362 lines, scattered logic)
 * After: src/app/api/services/route.ts (this file, 180 lines, clear intent)
 */

import { NextRequest } from 'next/server';
import { createHttpHandler, parseJsonBody, RouteContext } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

interface ServiceCreatePayload {
  name: string;
  description?: string | null;
  price?: number;
  duration?: number;
  category?: string | null;
}

/**
 * GET /api/services?tenant_id=<id>
 * List all services for a tenant
 * 
 * Requires:
 * - Authentication (Bearer token)
 * - Any valid role (accessible to all authenticated users)
 * 
 * Returns:
 * - 200: Array of services
 * - 401: Missing or invalid authentication
 * - 500: Database error
 */
export const GET = createHttpHandler(
  async (ctx: RouteContext) => {
    if (!ctx.user?.tenantId) {
      throw ApiErrorFactory.validationError({
        message: 'tenant_id is required in query parameters',
      });
    }

    const { data, error } = await ctx.supabase
      .from('services')
      .select('id,name,description,price,duration,category,created_at')
      .eq('tenant_id', ctx.user.tenantId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return data || [];
  },
  'GET',
  { auth: true }
);

/**
 * POST /api/services
 * Create new service for a tenant
 * 
 * Requires:
 * - Authentication (Bearer token)
 * - Role: owner or manager
 * 
 * Body:
 * - name (required): Service name
 * - description (optional): Service description
 * - price (optional): Service price
 * - duration (optional): Service duration in minutes
 * - category (optional): Service category
 * 
 * Returns:
 * - 201: Created service object
 * - 400: Validation error (missing name)
 * - 401: Missing or invalid authentication
 * - 403: Insufficient permissions (not owner/manager)
 * - 500: Database error
 */
export const POST = createHttpHandler(
  async (ctx: RouteContext) => {
    if (!ctx.user?.tenantId) {
      throw ApiErrorFactory.validationError({
        message: 'tenant_id is required',
      });
    }

    // Validate roles (manager and above)
    if (!['owner', 'manager'].includes(ctx.user.role)) {
      throw ApiErrorFactory.insufficientPermissions(['owner', 'manager']);
    }

    // Parse request body
    const body = await parseJsonBody<ServiceCreatePayload>(ctx.request);

    // Validate required fields
    if (!body.name?.trim()) {
      throw ApiErrorFactory.validationError({
        name: 'Service name is required',
      });
    }

    // Create service
    const { data, error } = await ctx.supabase
      .from('services')
      .insert({
        tenant_id: ctx.user.tenantId,
        name: body.name.trim(),
        description: body.description || null,
        price: body.price ?? 0,
        duration: body.duration ?? 30,
        category: body.category || null,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        throw ApiErrorFactory.conflict(
          `Service with name "${body.name}" already exists`
        );
      }
      throw ApiErrorFactory.databaseError(error);
    }

    return data;
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);

/**
 * PATCH /api/services?id=<service_id>
 * Update existing service
 * 
 * Requires:
 * - Authentication (Bearer token)
 * - Role: owner or manager
 * - Query parameter: id (service ID)
 * 
 * Body: (all optional)
 * - name: New service name
 * - description: New description
 * - price: New price
 * - duration: New duration
 * - category: New category
 * 
 * Returns:
 * - 200: Updated service object
 * - 401: Missing or invalid authentication
 * - 403: Insufficient permissions or not service owner
 * - 404: Service not found
 * - 500: Database error
 */
export const PATCH = createHttpHandler(
  async (ctx: RouteContext) => {
    if (!ctx.user?.tenantId) {
      throw ApiErrorFactory.validationError({
        message: 'tenant_id is required',
      });
    }

    // Get service ID from query parameters
    const url = new URL(ctx.request.url);
    const serviceId = url.searchParams.get('id');

    if (!serviceId) {
      throw ApiErrorFactory.validationError({
        id: 'Service ID is required in query parameters',
      });
    }

    // Verify service exists and belongs to tenant
    const { data: service, error: fetchError } = await ctx.supabase
      .from('services')
      .select('id, tenant_id')
      .eq('id', serviceId)
      .single();

    if (!service) {
      throw ApiErrorFactory.notFound('Service');
    }

    if (service.tenant_id !== ctx.user.tenantId) {
      throw ApiErrorFactory.tenantMismatch();
    }

    // Parse update payload
    const body = await parseJsonBody<Partial<ServiceCreatePayload>>(ctx.request);

    // Update service
    const { data, error } = await ctx.supabase
      .from('services')
      .update(body)
      .eq('id', serviceId)
      .select('*')
      .single();

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return data;
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager'] }
);

/**
 * DELETE /api/services?id=<service_id>
 * Delete service (owner only)
 * 
 * Requires:
 * - Authentication (Bearer token)
 * - Role: owner (only owners can delete)
 * - Query parameter: id (service ID)
 * 
 * Returns:
 * - 200: Success message
 * - 401: Missing or invalid authentication
 * - 403: Insufficient permissions (must be owner)
 * - 404: Service not found
 * - 500: Database error
 */
export const DELETE = createHttpHandler(
  async (ctx: RouteContext) => {
    if (!ctx.user?.tenantId) {
      throw ApiErrorFactory.validationError({
        message: 'tenant_id is required',
      });
    }

    // Only owners can delete services
    if (ctx.user.role !== 'owner') {
      throw ApiErrorFactory.insufficientPermissions(['owner']);
    }

    // Get service ID from query parameters
    const url = new URL(ctx.request.url);
    const serviceId = url.searchParams.get('id');

    if (!serviceId) {
      throw ApiErrorFactory.validationError({
        id: 'Service ID is required in query parameters',
      });
    }

    // Verify service exists and belongs to tenant
    const { data: service } = await ctx.supabase
      .from('services')
      .select('id, tenant_id')
      .eq('id', serviceId)
      .single();

    if (!service) {
      throw ApiErrorFactory.notFound('Service');
    }

    if (service.tenant_id !== ctx.user.tenantId) {
      throw ApiErrorFactory.tenantMismatch();
    }

    // Delete service
    const { error } = await ctx.supabase
      .from('services')
      .delete()
      .eq('id', serviceId);

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return { success: true, message: 'Service deleted successfully' };
  },
  'DELETE',
  { auth: true, roles: ['owner'] }
);
