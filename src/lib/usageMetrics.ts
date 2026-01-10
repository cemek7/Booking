import { createServerSupabaseClient } from '@/lib/supabase/server';
import metrics from './metrics';

// Helper attempts to upsert into usage_daily table (date bucket) else logs to console.
async function upsertDaily(supabase: SupabaseClient, tenantId: string, field: string, incr = 1) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  try {
    const { data } = await supabase
      .from('usage_daily')
      .select('id, ' + field)
      .eq('tenant_id', tenantId)
      .eq('day', today)
      .maybeSingle();
    if (!data) {
      const row: Record<string, unknown> = { tenant_id: tenantId, day: today, [field]: incr };
      await supabase.from('usage_daily').insert(row);
    } else {
      const currentVal = typeof (data as any)[field] === 'number' ? (data as any)[field] : 0;
      await supabase.from('usage_daily').update({ [field]: currentVal + incr }).eq('tenant_id', tenantId).eq('day', today);
    }
  } catch (e) {
    console.warn('usageMetrics: upsertDaily failed (table may not exist)', e);
  }
}

export async function incrBooking(supabase: SupabaseClient, tenantId: string) {
  await upsertDaily(supabase, tenantId, 'bookings', 1);
  await metrics.incr('booking_created');
}

export async function incrDeposit(supabase: SupabaseClient, tenantId: string) {
  await upsertDaily(supabase, tenantId, 'deposits', 1);
  await metrics.incr('deposit_initiated');
}

export async function addLlmTokens(supabase: SupabaseClient, tenantId: string, tokens: number) {
  await upsertDaily(supabase, tenantId, 'llm_tokens', tokens);
  await metrics.gauge('llm_tokens_last_add', tokens);
}

export default { incrBooking, incrDeposit, addLlmTokens };
