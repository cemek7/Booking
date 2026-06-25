import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { resolveApiTenantAccess } from '@/lib/auth/api-request';
import crypto from 'crypto';

export const runtime = 'nodejs';

async function uploadMediaToStorage(tenantId: string, file: File) {
  const supabase = createSupabaseAdminClient();
  const bucket = 'whatsapp-media';
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
  const filePath = `${tenantId}/showcase/${Date.now()}_${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(filePath, buffer, {
      contentType: file.type || 'application/octet-stream',
      cacheControl: '3600',
      upsert: false,
    });

  if (error) {
    throw new Error(error.message);
  }

  const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(data.path);
  return publicUrlData.publicUrl;
}

export async function GET(
  request: Request,
  { params }: { params: { packId: string } }
) {
  try {
    const access = await resolveApiTenantAccess(request);
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from('whatsapp_showcase_pack_items')
      .select('*')
      .eq('tenant_id', access.tenantId)
      .eq('pack_id', params.packId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ items: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    return NextResponse.json({ error: message }, { status: message === 'Forbidden' ? 403 : 401 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { packId: string } }
) {
  try {
    const access = await resolveApiTenantAccess(request);
    const supabase = createSupabaseAdminClient();

    let payload: Record<string, unknown> = {};
    let mediaUrl: string | null = null;
    let fileName: string | null = null;
    let mimeType = 'application/octet-stream';
    let fileSize = 0;

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (file instanceof File) {
        mediaUrl = await uploadMediaToStorage(access.tenantId, file);
        fileName = file.name;
        mimeType = file.type || mimeType;
        fileSize = file.size;
      }

      payload = {
        title: String(form.get('title') || '').trim(),
        caption: String(form.get('caption') || '').trim() || null,
        item_type: String(form.get('item_type') || 'image'),
        cta_label: String(form.get('cta_label') || '').trim() || null,
        cta_url: String(form.get('cta_url') || '').trim() || null,
        sort_order: Number(form.get('sort_order') || 0),
        metadata: form.get('metadata') ? JSON.parse(String(form.get('metadata'))) : {},
        media_url: String(form.get('media_url') || '').trim() || null,
        mime_type: String(form.get('mime_type') || mimeType),
        file_name: String(form.get('file_name') || fileName || '').trim() || null,
        file_size: fileSize,
      };
    } else {
      payload = await request.json();
    }

    const resolvedMediaUrl = mediaUrl || String(payload.media_url || '').trim();
    if (!resolvedMediaUrl) {
      return NextResponse.json({ error: 'media_url or file is required' }, { status: 400 });
    }

    const title = String(payload.title || '').trim();
    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('whatsapp_showcase_pack_items')
      .insert({
        tenant_id: access.tenantId,
        pack_id: params.packId,
        item_type: payload.item_type || 'image',
        title,
        caption: payload.caption || null,
        media_url: resolvedMediaUrl,
        mime_type: payload.mime_type || mimeType,
        file_name: payload.file_name || fileName || null,
        file_size: Number(payload.file_size || fileSize || 0),
        cta_label: payload.cta_label || null,
        cta_url: payload.cta_url || null,
        sort_order: Number(payload.sort_order || 0),
        metadata: payload.metadata || {},
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ item: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    return NextResponse.json({ error: message }, { status: message === 'Forbidden' ? 403 : 401 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { packId: string } }
) {
  try {
    const access = await resolveApiTenantAccess(request);
    const itemId = new URL(request.url).searchParams.get('id');
    if (!itemId) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from('whatsapp_showcase_pack_items')
      .delete()
      .eq('tenant_id', access.tenantId)
      .eq('pack_id', params.packId)
      .eq('id', itemId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    return NextResponse.json({ error: message }, { status: message === 'Forbidden' ? 403 : 401 });
  }
}
