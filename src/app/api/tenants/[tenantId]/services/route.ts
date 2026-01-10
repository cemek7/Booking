import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { validateTenantAccess, auditSuperadminAction, TenantAccessContext } from '@/lib/enhanced-rbac';

/**
 * GET,POST,PATCH,DELETE /api/tenants/[tenantId]/services
 * 
 * Migrated from: src/pages/api/tenants/[tenantId]/services.ts
 * 
 * Service catalog management for a specific tenant:
 * - GET: List all services (any tenant user)
 * - POST: Create service (manager+ only)
 * - PATCH: Update service (manager+ only)
 * - DELETE: Delete service (manager+ only)
 * 
 * Features:
 * - Automatic defaults for optional fields (duration=60min, price=0)
 * - Superadmin action auditing
 * - Access control: GET for all, mutations for manager+
 */

interface ServiceCreatePayload {
  name: string;
  duration_minutes?: number;
  price_cents?: number;
  active?: boolean;
  metadata?: Record<string, any>;
}

interface ServiceUpdatePayload extends Partial<ServiceCreatePayload> {
  id: string | number;
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
      .from('reservation_services')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(`[api/tenants/[tenantId]/services] GET error for tenant ${tenantId}:`, error);
      return NextResponse.json({ error: 'Database error while fetching services.' }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unknown error occurred';
    console.error('[api/tenants/[tenantId]/services] GET error', err);
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

    // Require manager/owner role or superadmin for mutations
    if (!['owner', 'manager'].includes(accessContext.userRole) && !accessContext.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: You need manager or owner rights to modify services.' },
        { status: 403 }
      );
    }

    const body: ServiceCreatePayload = await request.json();

    if (!body.name) {
      return NextResponse.json({ error: 'Service "name" is required.' }, { status: 400 });
    }

    // Audit superadmin action
    if (accessContext.isSuperAdmin) {
      await auditSuperadminAction(supabase, user.id, 'service_create', tenantId, undefined, undefined, { ...body }).catch(
        (err) => {
          console.warn('[api/tenants/[tenantId]/services] Failed to audit superadmin action', err);
        }
      );
    }

    const payload = {
      tenant_id: tenantId,
      name: body.name,
      duration_minutes: body.duration_minutes ?? 60,
      price_cents: body.price_cents ?? 0,
      active: body.active ?? true,
      metadata: body.metadata ?? null,
    };

    const { data, error } = await supabase.from('reservation_services').insert(payload).select().single();

    if (error) {
      console.error(`[api/tenants/[tenantId]/services] POST error for tenant ${tenantId}:`, error);
      return NextResponse.json({ error: 'Failed to create service.' }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unknown error occurred';
    console.error('[api/tenants/[tenantId]/services] POST error', err);
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

    // Require manager/owner role or superadmin for mutations
    if (!['owner', 'manager'].includes(accessContext.userRole) && !accessContext.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: You need manager or owner rights to modify services.' },
        { status: 403 }
      );
    }

    const body: ServiceUpdatePayload = await request.json();
    const { id, ...updateFields } = body;

    if (!id) {
      return NextResponse.json({ error: 'A service "id" is required in the request body.' }, { status: 400 });
    }

    if (Object.keys(updateFields).length === 0) {
      return NextResponse.json({ error: 'No update fields provided.' }, { status: 400 });
    }

    // Audit superadmin action
    if (accessContext.isSuperAdmin) {
      await auditSuperadminAction(
        supabase,
        user.id,
        'service_update',
        tenantId,
        undefined,
        String(id),
        { ...updateFields }
      ).catch((err) => {
        console.warn('[api/tenants/[tenantId]/services] Failed to audit superadmin action', err);
      });
    }

    const { data, error } = await supabase
      .from('reservation_services')
      .update(updateFields)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error(`[api/tenants/[tenantId]/services] PATCH error for service ${id} in tenant ${tenantId}:`, error);
      return NextResponse.json({ error: 'Failed to update service.' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unknown error occurred';
    console.error('[api/tenants/[tenantId]/services] PATCH error', err);
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

    // Require manager/owner role or superadmin for mutations
    if (!['owner', 'manager'].includes(accessContext.userRole) && !accessContext.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: You need manager or owner rights to modify services.' },
        { status: 403 }
      );
    }

    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'A service "id" is required in the request body.' }, { status: 400 });
    }

    // Audit superadmin action
    if (accessContext.isSuperAdmin) {
      await auditSuperadminAction(supabase, user.id, 'service_delete', tenantId, undefined, String(id)).catch((err) => {
        console.warn('[api/tenants/[tenantId]/services] Failed to audit superadmin action', err);
      });
    }

    const { error } = await supabase
      .from('reservation_services')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) {
      console.error(`[api/tenants/[tenantId]/services] DELETE error for service ${id} in tenant ${tenantId}:`, error);
      return NextResponse.json({ error: 'Failed to delete service.' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unknown error occurred';
    console.error('[api/tenants/[tenantId]/services] DELETE error', err);
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
