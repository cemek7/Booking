import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { validateTenantAccess, auditSuperadminAction, TenantAccessContext } from '@/lib/enhanced-rbac';
import { normalizeRole, type Role } from '@/types';

/**
 * GET,POST,PATCH,DELETE /api/tenants/[tenantId]/staff
 * 
 * Migrated from: src/pages/api/tenants/[tenantId]/staff.ts
 * 
 * Staff management for a specific tenant:
 * - GET: List all staff members with roles (any tenant user)
 * - POST: Add staff member by email (owner+ only)
 * - PATCH: Update staff role (owner+ only)
 * - DELETE: Remove staff member (owner+ only)
 * 
 * Features:
 * - Role normalization via normalizeRole()
 * - Superadmin action auditing
 * - Access control: GET for all, mutations for owner+
 */

interface StaffAddPayload {
  email: string;
  role: Role;
}

interface StaffUpdatePayload {
  userId: string;
  role: Role;
}

interface StaffRemovePayload {
  userId: string;
}

export async function GET(request: NextRequest, { params }: { params: { tenantId: string } }) {
  try {
    const { tenantId } = params;
    const supabase = getSupabaseRouteHandlerClient();

    // Extract and validate authentication
    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization token.' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);

    if (userErr || !user) {
      return NextResponse.json({ error: 'Authentication failed.' }, { status: 401 });
    }

    // Verify access to tenant
    const accessResult = await validateTenantAccess(supabase, user.id, tenantId);
    if (!accessResult || !('userRole' in accessResult)) {
      return NextResponse.json({ error: 'Forbidden: You do not have access to this tenant.' }, { status: 403 });
    }

    // GET is allowed for any valid tenant user
    const { data, error } = await supabase
      .from('tenant_users')
      .select('user_id,role,email,name')
      .eq('tenant_id', tenantId);

    if (error) {
      console.error(`[api/tenants/[tenantId]/staff] GET error for tenant ${tenantId}:`, error);
      return NextResponse.json({ error: 'Failed to retrieve staff list.' }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unknown error occurred';
    console.error('[api/tenants/[tenantId]/staff] GET error', err);
    return NextResponse.json({ error: 'Internal Server Error', details: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: { tenantId: string } }) {
  try {
    const { tenantId } = params;
    const supabase = getSupabaseRouteHandlerClient();

    // Extract and validate authentication
    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization token.' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);

    if (userErr || !user) {
      return NextResponse.json({ error: 'Authentication failed.' }, { status: 401 });
    }

    // Verify access and check permissions
    const accessResult = await validateTenantAccess(supabase, user.id, tenantId);
    if (!accessResult || !('userRole' in accessResult)) {
      return NextResponse.json({ error: 'Forbidden: You do not have access to this tenant.' }, { status: 403 });
    }

    const accessContext: TenantAccessContext = accessResult;

    // Require owner role or superadmin for mutations
    if (accessContext.userRole !== 'owner' && !accessContext.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden: You need owner rights to manage staff.' }, { status: 403 });
    }

    const { email, role }: StaffAddPayload = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    const validatedRole = normalizeRole(role || 'staff');
    if (!validatedRole) {
      return NextResponse.json({ error: 'Invalid role provided.' }, { status: 400 });
    }

    // Audit superadmin action
    if (accessContext.isSuperAdmin) {
      await auditSuperadminAction(
        supabase,
        user.id,
        'staff_add',
        tenantId,
        undefined,
        undefined,
        { targetEmail: email, role: validatedRole }
      ).catch((err) => {
        console.warn('[api/tenants/[tenantId]/staff] Failed to audit superadmin action', err);
      });
    }

    // Upsert staff member
    const { data, error } = await supabase
      .from('tenant_users')
      .upsert({ tenant_id: tenantId, email, role: validatedRole }, { onConflict: 'tenant_id, email' })
      .select()
      .single();

    if (error) {
      console.error(`[api/tenants/[tenantId]/staff] POST error for tenant ${tenantId}:`, error);
      return NextResponse.json({ error: 'Failed to add staff member.' }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unknown error occurred';
    console.error('[api/tenants/[tenantId]/staff] POST error', err);
    return NextResponse.json({ error: 'Internal Server Error', details: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { tenantId: string } }) {
  try {
    const { tenantId } = params;
    const supabase = getSupabaseRouteHandlerClient();

    // Extract and validate authentication
    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization token.' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);

    if (userErr || !user) {
      return NextResponse.json({ error: 'Authentication failed.' }, { status: 401 });
    }

    // Verify access and check permissions
    const accessResult = await validateTenantAccess(supabase, user.id, tenantId);
    if (!accessResult || !('userRole' in accessResult)) {
      return NextResponse.json({ error: 'Forbidden: You do not have access to this tenant.' }, { status: 403 });
    }

    const accessContext: TenantAccessContext = accessResult;

    // Require owner role or superadmin for mutations
    if (accessContext.userRole !== 'owner' && !accessContext.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden: You need owner rights to manage staff.' }, { status: 403 });
    }

    const { userId: targetUserId, role: newRole }: StaffUpdatePayload = await request.json();

    if (!targetUserId || !newRole) {
      return NextResponse.json({ error: 'userId and role are required.' }, { status: 400 });
    }

    const validatedRole = normalizeRole(newRole);
    if (!validatedRole) {
      return NextResponse.json({ error: 'Invalid role provided.' }, { status: 400 });
    }

    // Audit superadmin action
    if (accessContext.isSuperAdmin) {
      await auditSuperadminAction(
        supabase,
        user.id,
        'staff_update_role',
        tenantId,
        undefined,
        targetUserId,
        { newRole: validatedRole }
      ).catch((err) => {
        console.warn('[api/tenants/[tenantId]/staff] Failed to audit superadmin action', err);
      });
    }

    // Update staff role
    const { data, error } = await supabase
      .from('tenant_users')
      .update({ role: validatedRole })
      .eq('tenant_id', tenantId)
      .eq('user_id', targetUserId)
      .select()
      .single();

    if (error) {
      console.error(`[api/tenants/[tenantId]/staff] PATCH error for tenant ${tenantId}:`, error);
      return NextResponse.json({ error: 'Failed to update staff role.' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unknown error occurred';
    console.error('[api/tenants/[tenantId]/staff] PATCH error', err);
    return NextResponse.json({ error: 'Internal Server Error', details: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { tenantId: string } }) {
  try {
    const { tenantId } = params;
    const supabase = getSupabaseRouteHandlerClient();

    // Extract and validate authentication
    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization token.' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);

    if (userErr || !user) {
      return NextResponse.json({ error: 'Authentication failed.' }, { status: 401 });
    }

    // Verify access and check permissions
    const accessResult = await validateTenantAccess(supabase, user.id, tenantId);
    if (!accessResult || !('userRole' in accessResult)) {
      return NextResponse.json({ error: 'Forbidden: You do not have access to this tenant.' }, { status: 403 });
    }

    const accessContext: TenantAccessContext = accessResult;

    // Require owner role or superadmin for mutations
    if (accessContext.userRole !== 'owner' && !accessContext.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden: You need owner rights to manage staff.' }, { status: 403 });
    }

    const { userId: targetUserId }: StaffRemovePayload = await request.json();

    if (!targetUserId) {
      return NextResponse.json({ error: 'userId is required.' }, { status: 400 });
    }

    // Audit superadmin action
    if (accessContext.isSuperAdmin) {
      await auditSuperadminAction(
        supabase,
        user.id,
        'staff_remove',
        tenantId,
        undefined,
        targetUserId
      ).catch((err) => {
        console.warn('[api/tenants/[tenantId]/staff] Failed to audit superadmin action', err);
      });
    }

    // Remove staff member
    const { error } = await supabase
      .from('tenant_users')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('user_id', targetUserId);

    if (error) {
      console.error(`[api/tenants/[tenantId]/staff] DELETE error for tenant ${tenantId}:`, error);
      return NextResponse.json({ error: 'Failed to remove staff member.' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unknown error occurred';
    console.error('[api/tenants/[tenantId]/staff] DELETE error', err);
    return NextResponse.json({ error: 'Internal Server Error', details: message }, { status: 500 });
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'GET, POST, PATCH, DELETE, OPTIONS',
      'Content-Type': 'application/json',
    },
  });
}
