import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { resolveApiTenantAccess } from '@/lib/auth/api-request';
import type { ShowcasePackTemplateKind } from '@/lib/whatsapp/showcasePackService';

export const runtime = 'nodejs';

const TEMPLATE_PRESETS: Record<ShowcasePackTemplateKind, {
  intro_message: string;
  fallback_cta: string;
  trigger_phrases: string[];
}> = {
  custom: {
    intro_message: 'Here is a quick look at what we can do.',
    fallback_cta: 'Reply BOOK to continue.',
    trigger_phrases: ['show me', 'showcase'],
  },
  portfolio: {
    intro_message: 'Here is a quick portfolio of recent work.',
    fallback_cta: 'Reply BOOK if you want to book the same style.',
    trigger_phrases: ['portfolio', 'gallery', 'show me your work'],
  },
  price_list: {
    intro_message: 'Here is our current price list.',
    fallback_cta: 'Reply BOOK to choose a service.',
    trigger_phrases: ['price list', 'pricing', 'prices', 'menu'],
  },
  catalog: {
    intro_message: 'Here is a curated product and service catalog.',
    fallback_cta: 'Reply BOOK to place an order or schedule a visit.',
    trigger_phrases: ['catalog', 'products', 'services'],
  },
  before_after: {
    intro_message: 'Here are a few before-and-after examples.',
    fallback_cta: 'Reply BOOK to get the same result.',
    trigger_phrases: ['before and after', 'before after', 'transformation'],
  },
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function GET(request: Request) {
  try {
    const access = await resolveApiTenantAccess(request);
    const supabase = createSupabaseAdminClient();

    const { data, error } = await supabase
      .from('whatsapp_showcase_packs')
      .select(`
        id, tenant_id, name, template_kind, description, intro_message, trigger_phrases,
        fallback_cta, is_default, active, sort_order, created_at, updated_at,
        whatsapp_showcase_pack_items (id)
      `)
      .eq('tenant_id', access.tenantId)
      .order('is_default', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const packs = (data ?? []).map((pack: Record<string, unknown>) => ({
      ...pack,
      item_count: Array.isArray((pack as Record<string, unknown>).whatsapp_showcase_pack_items)
        ? ((pack as Record<string, unknown>).whatsapp_showcase_pack_items as unknown[]).length
        : 0,
    }));

    return NextResponse.json({ packs });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unauthorized' }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const access = await resolveApiTenantAccess(request);
    const body = await request.json();
    const supabase = createSupabaseAdminClient();

    const templateKind = (body.template_kind || 'custom') as ShowcasePackTemplateKind;
    const preset = TEMPLATE_PRESETS[templateKind] ?? TEMPLATE_PRESETS.custom;
    const name = String(body.name || `${templateKind.replace('_', ' ')} showcase`);
    const introMessage = String(body.intro_message || preset.intro_message);
    const triggerPhrases = Array.isArray(body.trigger_phrases) && body.trigger_phrases.length
      ? body.trigger_phrases.map((value: unknown) => String(value).trim()).filter(Boolean)
      : preset.trigger_phrases;

    if (body.is_default) {
      await supabase
        .from('whatsapp_showcase_packs')
        .update({ is_default: false })
        .eq('tenant_id', access.tenantId)
        .eq('is_default', true);
    }

    const { data, error } = await supabase
      .from('whatsapp_showcase_packs')
      .insert({
        tenant_id: access.tenantId,
        name,
        slug: slugify(name),
        template_kind: templateKind,
        description: body.description || null,
        intro_message: introMessage,
        trigger_phrases: triggerPhrases,
        fallback_cta: String(body.fallback_cta || preset.fallback_cta),
        is_default: !!body.is_default,
        active: body.active ?? true,
        sort_order: Number(body.sort_order ?? 0),
      })
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
