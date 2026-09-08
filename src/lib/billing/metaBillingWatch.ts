import type { SupabaseClient } from '@supabase/supabase-js';
import { deliverWalletAlert } from '@/lib/billing/walletAlerts';
import { META_PAYMENT_DEADLINE, daysBetween } from '@/lib/billing/platformAlerts';

/**
 * Warns tenants who own their own Meta billing relationship.
 *
 * Booka has two connection models. Tenants on the shared gateway ride Booka's
 * WhatsApp Business Account, and one payment method on Booka's side covers all
 * of them. Tenants who connected their own number — Embedded Signup or a direct
 * connection — have `meta_billing_owner = 'client'`: their own WABA, their own
 * Meta invoice, their own card. Booka adding a payment method does nothing for
 * them.
 *
 * On 2026-10-01 Meta stops delivering service messages for any account without
 * one. For a 'client' tenant that means their assistant goes silent, on a known
 * date, and neither they nor Booka would learn about it until customers
 * complained. Nothing in the product would raise an error.
 *
 * The dashboard alone is not enough here: WhatsApp-native owners never open it.
 * That is why this routes through deliverWalletAlert with whatsappOwner set —
 * the one path that reaches an owner who has only ever used chat.
 */

const NOTIFICATION_KIND = 'meta_payment_method';

export interface AtRiskTenant {
  tenantId: string;
  connectionSource: string | null;
}

/**
 * Tenants whose own Meta account needs a payment method.
 *
 * Deliberately includes rows where `meta_billing_owner` is NULL but the
 * connection source says the tenant brought their own number: the column was
 * added later than the connection flow, so an older self-connected tenant can
 * have a null owner and still be billed directly by Meta. Warning someone who
 * turns out to be covered costs one message; missing someone costs them their
 * whole assistant.
 */
export async function findTenantsOwningMetaBilling(
  admin: SupabaseClient,
): Promise<AtRiskTenant[]> {
  const { data, error } = await admin
    .from('whatsapp_configurations')
    .select('tenant_id, meta_billing_owner, meta_connection_source')
    .eq('provider', 'meta')
    .eq('active', true);

  if (error) {
    console.error('[metaBillingWatch] could not read whatsapp_configurations', error);
    return [];
  }

  const rows = (data ?? []) as Array<{
    tenant_id: string;
    meta_billing_owner: string | null;
    meta_connection_source: string | null;
  }>;

  return rows
    .filter((r) => {
      if (r.meta_billing_owner === 'booka') return false;      // covered by Booka's card
      if (r.meta_billing_owner === 'client') return true;
      // Owner not recorded: infer from how the connection was made.
      return r.meta_connection_source === 'embedded_signup' || r.meta_connection_source === 'direct';
    })
    .map((r) => ({ tenantId: r.tenant_id, connectionSource: r.meta_connection_source }));
}

/** True when this tenant already got the warning today. */
async function alreadyWarnedToday(
  admin: SupabaseClient,
  tenantId: string,
  now: Date,
): Promise<boolean> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const { data, error } = await admin
    .from('notifications')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('meta->>kind', NOTIFICATION_KIND)
    .gte('created_at', dayStart.toISOString())
    .limit(1);

  if (error) {
    // Fail toward NOT sending: a duplicate warning every hour would train the
    // owner to ignore the one that matters.
    console.warn('[metaBillingWatch] dedupe check failed, skipping', { tenantId, error });
    return true;
  }
  return (data ?? []).length > 0;
}

export function buildWarning(daysLeft: number): { title: string; message: string } {
  if (daysLeft < 0) {
    return {
      title: 'Your WhatsApp account needs a payment method',
      message:
        'WhatsApp now charges per message, and your business has its own WhatsApp Business '
        + 'account. Without a payment method on it, Meta stops delivering your replies — your '
        + 'assistant may already be silent. Add a card in Meta Business Manager to restore it.',
    };
  }
  return {
    title: `Add a payment method to your WhatsApp account (${daysLeft} day${daysLeft === 1 ? '' : 's'} left)`,
    message:
      'From 1 October WhatsApp charges per message, and your business has its own WhatsApp '
      + 'Business account. If there is no payment method on it by 30 September, Meta stops '
      + 'delivering your replies and your assistant goes quiet. Add a card in Meta Business Manager.',
  };
}

export interface WatchResult { checked: number; warned: number; skipped: number }

/**
 * Warns every at-risk tenant, at most once a day each. Never throws: this runs
 * on a schedule and one tenant's failure must not stop the rest.
 */
export async function runMetaPaymentWatch(
  admin: SupabaseClient,
  now: Date = new Date(),
): Promise<WatchResult> {
  const tenants = await findTenantsOwningMetaBilling(admin);
  const daysLeft = daysBetween(now, new Date(META_PAYMENT_DEADLINE));
  const { title, message } = buildWarning(daysLeft);

  let warned = 0;
  let skipped = 0;

  for (const t of tenants) {
    try {
      if (await alreadyWarnedToday(admin, t.tenantId, now)) { skipped += 1; continue; }
      await deliverWalletAlert(admin, {
        tenantId: t.tenantId,
        kind: 'wallet_handoff',
        title,
        message,
        meta: { kind: NOTIFICATION_KIND, days_left: daysLeft, connection_source: t.connectionSource },
        // Their assistant stops entirely if this is missed, and the owners most
        // likely to miss it are the ones who never open the dashboard.
        whatsappOwner: true,
      });
      warned += 1;
    } catch (error) {
      console.error('[metaBillingWatch] failed for tenant', { tenantId: t.tenantId, error });
    }
  }

  return { checked: tenants.length, warned, skipped };
}
