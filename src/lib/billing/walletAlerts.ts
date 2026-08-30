import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTransactionalEmail } from '@/lib/integrations/email-service';
import { getTenantWhatsAppProviderClientUnmetered } from '@/lib/whatsapp/providers/unmetered';

/**
 * Owner-facing delivery for message-wallet alerts.
 *
 * Before this existed the only owner-facing artefact was a `notifications` row,
 * which the owner sees ONLY if they are already logged into the dashboard — the
 * weakest possible signal at the moment they can least afford to miss it. The
 * Telegram line that sits alongside it goes to Booka's own ops channel
 * (process-level TELEGRAM_CHAT_ID), not to the tenant.
 *
 * Every channel here is best-effort and independent: one failing must not stop
 * the others, and none may throw into the caller. These are called from the
 * inbound message path.
 */

export type WalletAlertKind = 'wallet_low_balance' | 'wallet_handoff';

export interface WalletAlert {
  tenantId: string;
  kind: WalletAlertKind;
  title: string;
  message: string;
  /** Extra fields merged into the notifications row's `meta`. */
  meta?: Record<string, unknown>;
  /**
   * Also message the owner on WhatsApp. Reserve this for exhaustion — it costs
   * Booka a platform-funded message every time.
   */
  whatsappOwner?: boolean;
}

export interface TenantOwner {
  email?: string | null;
  phone?: string | null;
}

/**
 * The tenant owner's contact details. Staff and managers are deliberately
 * excluded: they cannot top up a wallet, so alerting them is noise.
 * Mirrors the existing lookup in src/lib/llmAlertService.ts.
 */
export async function resolveTenantOwner(
  admin: SupabaseClient,
  tenantId: string,
): Promise<TenantOwner | null> {
  const { data, error } = await admin
    .from('tenant_users')
    .select('email, phone')
    .eq('tenant_id', tenantId)
    .eq('role', 'owner')
    .maybeSingle();

  if (error) {
    console.warn('[walletAlerts] owner lookup failed', { tenantId, error });
    return null;
  }
  const row = data as TenantOwner | null;
  if (!row?.email && !row?.phone) return null;
  return row;
}

function emailHtml(alert: WalletAlert): string {
  return [
    `<p>${alert.message}</p>`,
    '<p>You can top up from your Boka dashboard under Billing.</p>',
  ].join('');
}

async function emailOwner(alert: WalletAlert, owner: TenantOwner): Promise<void> {
  if (!owner.email) return;
  // Transactional, never marketing: this must not be suppressed by a marketing
  // opt-out. A tenant who unsubscribed from product mail still needs to know
  // their bot has stopped replying.
  await sendTransactionalEmail({
    to: owner.email,
    subject: alert.title,
    html: emailHtml(alert),
    text: alert.message,
  });
}

async function whatsappOwner(alert: WalletAlert, owner: TenantOwner): Promise<void> {
  if (!owner.phone) return;

  // MUST be the unmetered client. The metered one would reserve credit against
  // the very wallet this alert is about, be refused, and fire a customer-facing
  // handoff — so the alert would fail at exactly the moment it is needed, and
  // would recurse. Deliberately platform-funded.
  const client = await getTenantWhatsAppProviderClientUnmetered(alert.tenantId);
  if (!client) return;
  await client.sendTextMessage(owner.phone, `${alert.title}\n\n${alert.message}`);
}

/**
 * Delivers one wallet alert across every channel the tenant has. Callers own
 * their own per-tenant-per-day deduplication — this function always delivers.
 */
export async function deliverWalletAlert(
  admin: SupabaseClient,
  alert: WalletAlert,
): Promise<void> {
  try {
    // notifications columns are: tenant_id, title, message, meta, read
    // (NO type/body/metadata).
    const { error } = await admin.from('notifications').insert({
      tenant_id: alert.tenantId,
      title: alert.title,
      message: alert.message,
      meta: { kind: alert.kind, ...(alert.meta ?? {}) },
      read: false,
    });
    if (error) {
      console.warn('[walletAlerts] in-app notification insert failed', {
        tenantId: alert.tenantId, error,
      });
    }

    const owner = await resolveTenantOwner(admin, alert.tenantId);
    if (!owner) {
      console.warn('[walletAlerts] no owner contact on file — dashboard row only', {
        tenantId: alert.tenantId,
      });
      return;
    }

    // Settled independently: a dead SMTP key must not cost the owner their
    // WhatsApp alert, and vice versa.
    const results = await Promise.allSettled([
      emailOwner(alert, owner),
      alert.whatsappOwner ? whatsappOwner(alert, owner) : Promise.resolve(),
    ]);
    results.forEach((r) => {
      if (r.status === 'rejected') {
        console.warn('[walletAlerts] a delivery channel failed', {
          tenantId: alert.tenantId, reason: r.reason,
        });
      }
    });
  } catch (error) {
    // An alert is never worth breaking a send for.
    console.warn('[walletAlerts] deliverWalletAlert failed', { tenantId: alert.tenantId, error });
  }
}
