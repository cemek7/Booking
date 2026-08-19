import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { resolveApiTenantAccess } from '@/lib/auth/api-request';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ packId: string }> }
) {
  const { packId } = await params;
  try {
    const access = await resolveApiTenantAccess(request);
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from('whatsapp_showcase_packs')
      .select(`
        id, tenant_id, name, template_kind, description, intro_message, trigger_phrases,
        fallback_cta, is_default, active, sort_order, created_at, updated_at,
        whatsapp_showcase_pack_items (
          id, tenant_id, pack_id, item_type, title, caption, media_url, mime_type,
          file_name, file_size, cta_label, cta_url, sort_order, metadata, active,
          created_at, updated_at
        )
      `)
      .eq('tenant_id', access.tenantId)
      .eq('id', packId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ pack: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    return NextResponse.json({ error: message }, { status: message === 'Forbidden' ? 403 : 401 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ packId: string }> }
) {
  const { packId } = await params;
  try {
    const access = await resolveApiTenantAccess(request);
    const body = await request.json();
    const supabase = createSupabaseAdminClient();

    if (body.is_default) {
      await supabase
        .from('whatsapp_showcase_packs')
        .update({ is_default: false })
        .eq('tenant_id', access.tenantId)
        .eq('is_default', true);
    }

    const { data, error } = await supabase
      .from('whatsapp_showcase_packs')
      .update({
        name: body.name,
        description: body.description,
        intro_message: body.intro_message,
        trigger_phrases: body.trigger_phrases,
        fallback_cta: body.fallback_cta,
        is_default: body.is_default,
        active: body.active,
        sort_order: body.sort_order,
        template_kind: body.template_kind,
      })
      .eq('tenant_id', access.tenantId)
      .eq('id', packId)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ pack: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    return NextResponse.json({ error: message }, { status: message === 'Forbidden' ? 403 : 401 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ packId: string }> }
) {
  const { packId } = await params;
  try {
    const access = await resolveApiTenantAccess(request);
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from('whatsapp_showcase_packs')
      .delete()
      .eq('tenant_id', access.tenantId)
      .eq('id', packId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    return NextResponse.json({ error: message }, { status: message === 'Forbidden' ? 403 : 401 });
  }
}
