import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTelegramInfo } from '@/lib/monitoring/telegramAlert';

type AlertReason = 'soft_warn' | 'daily_cap' | 'velocity_cap';

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function maybeAlertCap(
  admin: SupabaseClient,
  tenantId: string,
  reason: AlertReason,
): Promise<void> {
  try {
    if (reason === 'velocity_cap') {
      console.warn(`[spendAlerts] velocity cap hit for tenant ${tenantId}`);
      return;
    }

    const today = todayIsoDate();
    const { data, error } = await admin
      .from('ai_wallets')
      .select('budget_warned_on')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (data?.budget_warned_on === today) {
      return;
    }

    const title = reason === 'daily_cap'
      ? 'AI paused for today'
      : 'AI budget warning';
    const body = reason === 'daily_cap'
      ? 'AI spend hit today’s wallet budget, so the tenant is running rules-only until reset.'
      : 'AI spend reached the daily warning threshold for this tenant.';

    // notifications columns are: tenant_id, title, message, meta, read (NO type/body/metadata).
    await admin.from('notifications').insert({
      tenant_id: tenantId,
      title,
      message: body,
      meta: { kind: 'spend_cap', reason },
      read: false,
    });

    await admin
      .from('ai_wallets')
      .upsert({
        tenant_id: tenantId,
        budget_warned_on: today,
      }, { onConflict: 'tenant_id' });

    await sendTelegramInfo(`Spend cap ${reason} for tenant ${tenantId}.`);
  } catch (error) {
    console.warn('[spendAlerts] failed to emit spend-cap alert', error);
  }
}
