import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { ensureOwnerForTenant } from '@/types/unified-permissions';

/**
 * GET /api/admin/tenant/[id]/settings
 * Retrieve tenant settings (name, timezone, LLM preferences)
 *
 * Auth: None (public endpoint)
 * RBAC: None (public read)
 *
 * Response: { row: TenantSettings | null }
 */
async function handleGET(tenantId: string) {
  const supabase = getSupabaseRouteHandlerClient();

  const { data: row, error } = await supabase
    .from('tenants')
    .select('id,name,timezone,preferred_llm_model,llm_token_rate')
    .eq('id', tenantId)
    .maybeSingle();

  if (error) {
    console.error('[api/admin/tenant/[id]/settings] failed to load tenant', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }

  return NextResponse.json({ row: row ?? null }, { status: 200 });
}

/**
 * PUT /api/admin/tenant/[id]/settings
 * Update tenant settings (owner-only)
 *
 * Auth: Bearer token required
 * RBAC: Owner-only (ensureOwnerForTenant check)
 * Allowed fields: name, timezone, preferred_llm_model, llm_token_rate
 *
 * Response: { success: true, row: TenantSettings }
 */
async function handlePUT(request: NextRequest, tenantId: string) {
  // Extract and validate Bearer token
  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'missing_authorization' }, { status: 401 });
  }

  const token = authHeader.split(' ')[1];
  const supabase = getSupabaseRouteHandlerClient();

  // Verify token and actor
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) {
    console.error('[api/admin/tenant/[id]/settings] failed to verify user token', userErr);
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  }

  const actorId = userData.user.id;

  // RBAC: Check actor is owner of tenant
  try {
    await ensureOwnerForTenant(supabase, actorId, tenantId);
  } catch (e) {
    console.error('[api/admin/tenant/[id]/settings] rbac guard failed', e);
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Parse request body
  const body = await request.json().catch(() => ({}));

  // Allowed fields for update
  const allowedKeys = new Set([
    'name',
    'timezone',
    'preferred_llm_model',
    'llm_token_rate',
  ]);

  const payload: Record<string, unknown> = {};
  for (const k of Object.keys(body)) {
    if (allowedKeys.has(k)) {
      // Normalize values
      if (k === 'llm_token_rate') {
        payload.llm_token_rate = body[k] === '' ? null : Number(body[k]);
      } else if (typeof body[k] === 'string') {
        payload[k] = (body[k] as string).trim();
      } else {
        payload[k] = body[k];
      }
    }
  }

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });
  }

  const { data: updated, error: updateErr } = await supabase
    .from('tenants')
    .update(payload)
    .eq('id', tenantId)
    .select()
    .maybeSingle();

  if (updateErr) {
    console.error('[api/admin/tenant/[id]/settings] failed updating tenant settings', updateErr);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  return NextResponse.json({ success: true, row: updated ?? null }, { status: 200 });
}

/**
 * Main route handler
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const tenantId = params.id;
  if (!tenantId || typeof tenantId !== 'string') {
    return NextResponse.json({ error: 'missing_tenant_id' }, { status: 400 });
  }

  return handleGET(tenantId);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const tenantId = params.id;
  if (!tenantId || typeof tenantId !== 'string') {
    return NextResponse.json({ error: 'missing_tenant_id' }, { status: 400 });
  }

  try {
    return await handlePUT(request, tenantId);
  } catch (e) {
    console.error('[api/admin/tenant/[id]/settings] handler failed', e);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}

/**
 * OPTIONS /api/admin/tenant/[id]/settings
 * CORS preflight handler
 */
export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'GET, PUT, OPTIONS',
      'Content-Type': 'application/json',
    },
  });
}
