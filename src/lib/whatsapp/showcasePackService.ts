import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { defaultLogger } from '@/lib/logger';
import { getTenantWhatsAppConfig } from '@/lib/whatsapp/evolutionClient';
import { getProviderClient } from '@/lib/whatsapp/providers';

export type ShowcasePackTemplateKind = 'custom' | 'portfolio' | 'price_list' | 'catalog' | 'before_after';
export type ShowcaseItemType = 'image' | 'document' | 'video';

export interface ShowcasePackItem {
  id: string;
  tenant_id: string;
  pack_id: string;
  item_type: ShowcaseItemType;
  title: string;
  caption: string | null;
  media_url: string;
  mime_type: string;
  file_name: string | null;
  file_size: number;
  cta_label: string | null;
  cta_url: string | null;
  sort_order: number;
  metadata: Record<string, unknown>;
  active: boolean;
  created_at: string;
  updated_at?: string | null;
}

export interface ShowcasePack {
  id: string;
  tenant_id: string;
  name: string;
  template_kind: ShowcasePackTemplateKind;
  description: string | null;
  intro_message: string | null;
  trigger_phrases: string[];
  fallback_cta: string;
  is_default: boolean;
  active: boolean;
  sort_order: number;
  items?: ShowcasePackItem[];
  item_count?: number;
  created_at: string;
  updated_at?: string | null;
}

const SHOWCASE_KEYWORDS = [
  'portfolio',
  'show me your work',
  'gallery',
  'before after',
  'before & after',
  'catalog',
  'products',
  'price list',
  'menu',
  'lookbook',
  'examples',
  'showcase',
];

function normalizeText(text: string): string {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function looksLikeShowcaseRequest(text: string): boolean {
  const normalized = normalizeText(text);
  return SHOWCASE_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export async function listShowcasePacks(tenantId: string): Promise<ShowcasePack[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('whatsapp_showcase_packs')
    .select('id, tenant_id, name, template_kind, description, intro_message, trigger_phrases, fallback_cta, is_default, active, sort_order, created_at, updated_at, whatsapp_showcase_pack_items(id)')
    .eq('tenant_id', tenantId)
    .order('is_default', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...(row as unknown as ShowcasePack),
    item_count: Array.isArray((row as Record<string, unknown>).whatsapp_showcase_pack_items)
      ? ((row as Record<string, unknown>).whatsapp_showcase_pack_items as unknown[]).length
      : 0,
  }));
}

export async function getShowcasePack(tenantId: string, packId: string): Promise<ShowcasePack | null> {
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
    .eq('tenant_id', tenantId)
    .eq('id', packId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) return null;
  return data as ShowcasePack;
}

export async function getDefaultShowcasePack(tenantId: string): Promise<ShowcasePack | null> {
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
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('is_default', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as ShowcasePack | null;
}

export async function pickShowcasePackForMessage(
  tenantId: string,
  message: string
): Promise<ShowcasePack | null> {
  const packs = await listShowcasePacks(tenantId);
  const normalized = normalizeText(message);
  const byTrigger = packs.find((pack) =>
    (pack.trigger_phrases || []).some((phrase) => normalized.includes(normalizeText(phrase)))
  );
  return byTrigger ?? packs.find((pack) => pack.is_default) ?? (packs[0] ?? null);
}

export async function sendShowcasePack(
  tenantId: string,
  customerPhone: string,
  packId?: string,
  triggerText?: string
): Promise<{ success: boolean; sentCount: number; pack?: ShowcasePack | null; reason?: string }> {
  const pack = packId
    ? await getShowcasePack(tenantId, packId)
    : triggerText
      ? await pickShowcasePackForMessage(tenantId, triggerText)
      : await getDefaultShowcasePack(tenantId);

  if (!pack) {
    return { success: false, sentCount: 0, reason: 'no_showcase_pack_found' };
  }

  const fullPack = Array.isArray(pack.items) ? pack : (await getShowcasePack(tenantId, pack.id)) ?? pack;
  const items = (fullPack.items ?? [])
    .filter((item) => item.active)
    .sort((a, b) => a.sort_order - b.sort_order);

  if (!items.length) {
    return { success: false, sentCount: 0, pack: fullPack, reason: 'pack_has_no_items' };
  }

  const config = await getTenantWhatsAppConfig(tenantId);
  if (!config) {
    return { success: false, sentCount: 0, pack: fullPack, reason: 'whatsapp_config_missing' };
  }

  const client = getProviderClient(config);
  const intro = pack.intro_message || `Here is a quick look at ${pack.name}.`;
  let sentCount = 0;

  try {
    await client.sendTextMessage(customerPhone, intro);
    sentCount += 1;
  } catch (error) {
    defaultLogger.warn('showcase: intro message failed', error);
  }

  for (const item of items) {
    try {
      const captionBits = [
        item.title ? `*${item.title}*` : '',
        item.caption || '',
        item.cta_label && item.cta_url ? `${item.cta_label}: ${item.cta_url}` : '',
      ].filter(Boolean);
      const caption = captionBits.join('\n\n');

      await client.sendMediaMessage(
        customerPhone,
        {
          url: item.media_url,
          mimetype: item.mime_type,
          filename: item.file_name ?? undefined,
        },
        caption,
        item.item_type
      );
      sentCount += 1;
    } catch (error) {
      defaultLogger.warn('showcase: media message failed', {
        tenantId,
        packId: pack.id,
        itemId: item.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    const interactiveResult = await client.sendInteractiveMessage(customerPhone, {
      type: 'button',
      body: {
        text: pack.fallback_cta || 'What would you like to do next?'
      },
      footer: {
        text: 'Booka AI Front Desk'
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: { id: 'showcase_book', title: '📅 Book' }
          },
          {
            type: 'reply',
            reply: { id: 'showcase_prices', title: '💬 Get Quote' }
          },
          {
            type: 'reply',
            reply: { id: 'showcase_help', title: '❓ Ask Question' }
          },
        ],
      },
    });

    if (interactiveResult.success) {
      sentCount += 1;
    } else {
      await client.sendTextMessage(customerPhone, pack.fallback_cta || 'Reply BOOK to continue.');
      sentCount += 1;
    }
  } catch (error) {
    defaultLogger.warn('showcase: closing CTA failed', error);
  }

  return { success: sentCount > 0, sentCount, pack: fullPack };
}
