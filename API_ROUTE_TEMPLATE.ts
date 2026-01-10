/**
 * TEMPLATE FOR CONVERTING API ROUTES
 * 
 * Copy this template and customize for each endpoint being migrated
 * 
 * Migration checklist:
 * ✓ Remove inline Bearer token extraction
 * ✓ Remove manual user validation
 * ✓ Remove manual role checking
 * ✓ Use ctx.user and ctx.supabase
 * ✓ Replace try/catch with ApiErrorFactory
 * ✓ Update error responses to new format
 * ✓ Test with curl or Postman
 * ✓ Verify error codes and status codes
 */

import { NextRequest } from 'next/server';
import { createHttpHandler, RouteContext, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import {
  getTenantId,
  getResourceId,
  getPaginationParams,
  verifyOwnership,
  verifyTenantOwnership,
  validateRequestBody,
  executeDb,
  createPaginatedResponse,
} from '@/lib/error-handling/migration-helpers';

/**
 * TEMPLATE: GET /api/[resource]
 * List resources for a tenant
 */
export const GET = createHttpHandler(
  async (ctx: RouteContext) => {
    // Get tenant ID (from params, query, or user context)
    const tenantId = await getTenantId(ctx);

    // Get pagination
    const { page, limit, offset } = getPaginationParams(ctx);

    // Query database
    const { data, error } = await ctx.supabase
      .from('table_name') // UPDATE THIS
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw ApiErrorFactory.databaseError(error);

    // Get total count
    const { count } = await ctx.supabase
      .from('table_name')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    return createPaginatedResponse(data || [], count || 0, page, limit);
  },
  'GET',
  {
    auth: true,
    // roles: ['owner', 'manager', 'staff'], // UPDATE THIS if needed
  }
);

/**
 * TEMPLATE: POST /api/[resource]
 * Create new resource
 */
export const POST = createHttpHandler(
  async (ctx: RouteContext) => {
    // Get tenant ID
    const tenantId = await getTenantId(ctx);

    // Parse and validate body
    const body = await parseJsonBody<{
      name: string;
      // Add other fields
    }>(ctx.request);

    // Validate required fields
    if (!body.name?.trim()) {
      throw ApiErrorFactory.validationError({
        name: 'Name is required',
      });
    }

    // Check permissions if needed
    if (ctx.user?.role !== 'owner' && ctx.user?.role !== 'manager') {
      throw ApiErrorFactory.insufficientPermissions(['owner', 'manager']);
    }

    // Insert into database
    const { data, error } = await ctx.supabase
      .from('table_name') // UPDATE THIS
      .insert({
        tenant_id: tenantId,
        name: body.name.trim(),
        // Add other fields
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Unique constraint
        throw ApiErrorFactory.conflict(`Resource with name "${body.name}" already exists`);
      }
      throw ApiErrorFactory.databaseError(error);
    }

    return data;
  },
  'POST',
  {
    auth: true,
    roles: ['owner', 'manager'], // UPDATE THIS
  }
);

/**
 * TEMPLATE: PATCH /api/[resource]/[id]
 * Update resource
 */
export const PATCH = createHttpHandler(
  async (ctx: RouteContext) => {
    // Get resource ID and tenant ID
    const resourceId = await getResourceId(ctx, 'id');
    const tenantId = await getTenantId(ctx);

    // Verify resource exists and belongs to tenant
    await verifyTenantOwnership(ctx, 'table_name', resourceId); // UPDATE THIS

    // Parse update payload
    const body = await parseJsonBody(ctx.request);

    // Update in database
    const { data, error } = await ctx.supabase
      .from('table_name') // UPDATE THIS
      .update(body)
      .eq('id', resourceId)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) throw ApiErrorFactory.databaseError(error);

    return data;
  },
  'PATCH',
  {
    auth: true,
    roles: ['owner', 'manager'], // UPDATE THIS
  }
);

/**
 * TEMPLATE: DELETE /api/[resource]/[id]
 * Delete resource
 */
export const DELETE = createHttpHandler(
  async (ctx: RouteContext) => {
    // Get resource ID and tenant ID
    const resourceId = await getResourceId(ctx, 'id');
    const tenantId = await getTenantId(ctx);

    // Verify ownership (only owners can delete)
    if (ctx.user?.role !== 'owner') {
      throw ApiErrorFactory.insufficientPermissions(['owner']);
    }

    // Verify resource exists and belongs to tenant
    await verifyTenantOwnership(ctx, 'table_name', resourceId); // UPDATE THIS

    // Delete from database
    const { error } = await ctx.supabase
      .from('table_name') // UPDATE THIS
      .delete()
      .eq('id', resourceId)
      .eq('tenant_id', tenantId);

    if (error) throw ApiErrorFactory.databaseError(error);

    return { success: true, message: 'Resource deleted successfully' };
  },
  'DELETE',
  {
    auth: true,
    roles: ['owner'], // UPDATE THIS
  }
);

/*
 * MIGRATION NOTES:
 * 
 * 1. Replace 'table_name' with actual database table
 * 2. Update role requirements in each handler
 * 3. Add proper field validation in POST/PATCH
 * 4. Add any custom business logic
 * 5. Test with:
 *    GET    /api/[resource]
 *    POST   /api/[resource] with JSON body
 *    PATCH  /api/[resource]?id=123 with JSON body
 *    DELETE /api/[resource]?id=123
 * 6. Verify error responses match new format
 * 7. Check role-based access control
 * 8. Delete original endpoint file after verification
 */
