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
   *
   * Note that an owner with NO email always gets WhatsApp regardless, because
   * otherwise they get nothing at all: WhatsApp-native tenants are onboarded
   * phone-first (see ownerOnboarding.ts, which inserts an owner row with
   * user_id and email both NULL), so "every owner has an email" is false for
   * exactly the segment Booka onboards over WhatsApp.
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
 *
 * Deliberately NOT `.maybeSingle()`, unlike the older lookup in
 * llmAlertService.ts. `tenant_users` has a primary key on `id` and nothing
 * else — no unique constraint on (tenant_id, role) — so a tenant with two owner
 * rows is structurally possible, and `.maybeSingle()` errors on more than one
 * match. That would turn "this tenant has two owners" into "this tenant gets no
 * alert at all", silently, for the tenant most likely to have a messy setup.
 * Take the rows and pick the most contactable instead.
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
    .limit(5);

  if (error) {
    console.warn('[walletAlerts] owner lookup failed', { tenantId, error });
    return null;
  }

  const rows = (Array.isArray(data) ? data : data ? [data] : []) as TenantOwner[];
  // Prefer a row with an email, then any row with a phone. With duplicate owner
  // rows the first one is not necessarily the populated one.
  const withEmail = rows.find((r) => !!r?.email);
  const withPhone = rows.find((r) => !!r?.phone);
  if (!withEmail && !withPhone) return null;
  return { email: withEmail?.email ?? null, phone: withEmail?.phone ?? withPhone?.phone ?? null };
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
    // An owner with no email gets WhatsApp whatever the alert asked for —
    // otherwise a WhatsApp-native tenant, onboarded phone-first with no email on
    // file, would silently receive nothing at all from the low-balance warning.
    const needsWhatsapp = alert.whatsappOwner || !owner.email;
    if (!alert.whatsappOwner && needsWhatsapp) {
      console.info('[walletAlerts] owner has no email on file, alerting over WhatsApp instead', {
        tenantId: alert.tenantId, kind: alert.kind,
      });
    }

    const results = await Promise.allSettled([
      emailOwner(alert, owner),
      needsWhatsapp ? whatsappOwner(alert, owner) : Promise.resolve(),
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
