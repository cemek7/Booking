import type { SupabaseClient } from '@supabase/supabase-js';

const TIER_LIMITS: Record<string, number> = {
  TIER_250: 250,
  TIER_1K: 1000,
  TIER_10K: 10000,
  TIER_100K: 100000,
  TIER_UNLIMITED: 1000000,
};

type ChangeValue = {
  metadata?: { phone_number_id?: string };
  phone_number_id?: string;
  quality_rating?: string;
  current_limit?: string;
  max_daily_conversations_per_business?: string;
  messaging_limit_tier?: string;
  display_phone_number?: string;
  event?: string;
  status?: string;
  account_review_status?: string;
  current_quality_update?: { quality_rating?: string };
  message_template_id?: string;
  message_template_name?: string;
  message_template_language?: string;
  message_template_status?: string;
};

export interface MetaQualityChange {
  field?: string;
  value?: ChangeValue;
}

async function updateTemplateStatus(admin: SupabaseClient, change: MetaQualityChange): Promise<void> {
  const templateName = change.value?.message_template_name;
  const language = change.value?.message_template_language;
  const status = change.value?.message_template_status;

  if (!templateName || !language || !status) return;

  await admin
    .from('message_templates')
    .update({
      status: String(status).toLowerCase(),
      updated_at: new Date().toISOString(),
    })
    .eq('template_name', templateName)
    .eq('language', language);
}

function extractPhoneNumberId(change: MetaQualityChange): string | null {
  return change.value?.metadata?.phone_number_id ?? change.value?.phone_number_id ?? null;
}

function extractQuality(change: MetaQualityChange): string {
  return (
    change.value?.quality_rating ??
    change.value?.current_quality_update?.quality_rating ??
    'UNKNOWN'
  );
}

function extractLimit(change: MetaQualityChange): number {
  const rawTier =
    change.value?.messaging_limit_tier ??
    change.value?.max_daily_conversations_per_business ??
    change.value?.current_limit;

  if (!rawTier) return 1000;
  return TIER_LIMITS[rawTier] ?? 1000;
}

function extractAccountStatus(change: MetaQualityChange): string | null {
  return change.value?.account_review_status ?? change.value?.status ?? change.value?.event ?? null;
}

export async function ingestQualityWebhook(
  admin: SupabaseClient,
  change: MetaQualityChange,
): Promise<void> {
  if (change.field === 'message_template_status_update') {
    await updateTemplateStatus(admin, change);
    return;
  }

  const phoneNumberId = extractPhoneNumberId(change);
  if (!phoneNumberId) return;

  await admin.from('whatsapp_number_quality').upsert({
    phone_number_id: phoneNumberId,
    quality_rating: extractQuality(change),
    messaging_tier:
      change.value?.messaging_limit_tier ??
      change.value?.max_daily_conversations_per_business ??
      change.value?.current_limit ??
      null,
    limit_per_24h: extractLimit(change),
    account_status: extractAccountStatus(change),
    updated_at: new Date().toISOString(),
  });
}
