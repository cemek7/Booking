import type { SupabaseClient } from '@supabase/supabase-js';
import { CFG, type Quality } from './config';

export interface NumberQuality {
  phoneNumberId: string;
  quality: Quality;
  limitPer24h: number;
}

export async function loadNumberQuality(admin: SupabaseClient, _tenantId: string): Promise<NumberQuality> {
  const phoneNumberId = CFG.sharedPhoneNumberId();
  const { data } = await admin
    .from('whatsapp_number_quality')
    .select('quality_rating, limit_per_24h')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle();

  return {
    phoneNumberId,
    quality: (data?.quality_rating as Quality) ?? 'UNKNOWN',
    limitPer24h: Number(data?.limit_per_24h ?? 250),
  };
}
