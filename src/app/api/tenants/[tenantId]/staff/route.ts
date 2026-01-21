import { z } from 'zod';
import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { normalizeRole, type Role } from '@/types';

const AddStaffBodySchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.string().optional().default('staff'),
});

const UpdateStaffBodySchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  role: z.string().min(1, 'Role is required'),
});

const RemoveStaffBodySchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
});

/**
 * GET /api/tenants/[tenantId]/staff
 * List all staff members with roles.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    // Verify the caller has access to this tenant
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const { data, error } = await ctx.supabase
      .from('tenant_users')
      .select('user_id, role, email, name')
      .eq('tenant_id', tenantId);

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return data ?? [];
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);

/**
 * POST /api/tenants/[tenantId]/staff
 * Add a new staff member by email.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    // Verify the caller has access to this tenant
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const body = await ctx.request.json();
    const bodyValidation = AddStaffBodySchema.safeParse(body);
    if (!bodyValidation.success) {
      throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
    }

    const { email, role } = bodyValidation.data;
    const validatedRole = normalizeRole(role as Role);
    if (!validatedRole) {
      throw ApiErrorFactory.validationError({ role: 'Invalid role provided' });
    }

    // Upsert staff member
    const { data, error } = await ctx.supabase
      .from('tenant_users')
      .upsert({ tenant_id: tenantId, email, role: validatedRole }, { onConflict: 'tenant_id,email' })
      .select()
      .single();

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return new NextResponse(JSON.stringify(data), { status: 201 });
  },
  'POST',
  { auth: true, roles: ['owner'] }
);

/**
 * PATCH /api/tenants/[tenantId]/staff
 * Update a staff member's role.
 */
export const PATCH = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    // Verify the caller has access to this tenant
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const body = await ctx.request.json();
    const bodyValidation = UpdateStaffBodySchema.safeParse(body);
    if (!bodyValidation.success) {
      throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
    }

    const { userId: targetUserId, role: newRole } = bodyValidation.data;
    const validatedRole = normalizeRole(newRole as Role);
    if (!validatedRole) {
      throw ApiErrorFactory.validationError({ role: 'Invalid role provided' });
    }

    const { data, error } = await ctx.supabase
      .from('tenant_users')
      .update({ role: validatedRole })
      .eq('tenant_id', tenantId)
      .eq('user_id', targetUserId)
      .select()
      .single();

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return { staff: data };
  },
  'PATCH',
  { auth: true, roles: ['owner'] }
);

/**
 * DELETE /api/tenants/[tenantId]/staff
 * Remove a staff member.
 */
export const DELETE = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    // Verify the caller has access to this tenant
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const body = await ctx.request.json();
    const bodyValidation = RemoveStaffBodySchema.safeParse(body);
    if (!bodyValidation.success) {
      throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
    }

    const { userId: targetUserId } = bodyValidation.data;

    const { error } = await ctx.supabase
      .from('tenant_users')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('user_id', targetUserId);

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return { success: true };
  },
  'DELETE',
  { auth: true, roles: ['owner'] }
);

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'GET, POST, PATCH, DELETE, OPTIONS',
      'Content-Type': 'application/json',
    },
  });
}
