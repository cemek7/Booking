import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTransactionalEmail } from '@/lib/integrations/email-service';
import { resolveTenantOwner } from '@/lib/billing/walletAlerts';

/**
 * Delivering a promo code.
 *
 * 146 stores only a hash, so creation is the single moment the plaintext
 * exists. Copy-and-paste alone makes that moment fragile — close the tab and
 * the code is gone. This sends it to the people who need it while it is still
 * in memory.
 *
 * Deliberately transactional, not marketing. A marketing send is suppressed
 * for anyone who has opted out, and a silent suppression here would destroy
 * the code — the exact failure this module exists to prevent. The caller is
 * still told the outcome so the code stays on screen when delivery fails.
 */

export type PromoDeliveryOutcome = {
  attempted: boolean;
  sentTo: string[];
  failed: Array<{ email: string; error: string }>;
};

/** Superadmin-supplied text lands in an HTML body; escape it. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function billingUrl(): string {
  const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '';
  return base ? `${base.replace(/\/$/, '')}/dashboard/billing` : '';
}

export function buildPromoEmail(params: {
  code: string;
  campaign: string;
  amountCredits: number;
  expiresAt?: string | null;
}): { subject: string; html: string; text: string } {
  const expiry = params.expiresAt
    ? new Date(params.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const credits = params.amountCredits.toLocaleString();
  const link = billingUrl();

  const subject = `Your promo code: ${credits} credits`;

  const text = [
    `Here is a promo code for ${credits} credits on your Booka wallet.`,
    '',
    `Code: ${params.code}`,
    `Campaign: ${params.campaign}`,
    expiry ? `Valid until: ${expiry}` : 'No expiry date.',
    '',
    'To redeem it, open Billing in your dashboard, enter the code under',
    '"Have a promo code?" and the credits are added straight away.',
    link ? `\n${link}` : '',
    '',
    'Keep this email — the code cannot be sent again.',
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;color:#0f172a">
      <p>Here is a promo code for <strong>${escapeHtml(credits)} credits</strong> on your Booka wallet.</p>
      <p style="margin:24px 0;text-align:center">
        <span style="display:inline-block;border:1px solid #cbd5e1;border-radius:12px;padding:14px 22px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;letter-spacing:3px">
          ${escapeHtml(params.code)}
        </span>
      </p>
      <p style="color:#475569;font-size:14px">
        Campaign: ${escapeHtml(params.campaign)}<br>
        ${expiry ? `Valid until ${escapeHtml(expiry)}` : 'No expiry date.'}
      </p>
      <p>To redeem it, open <strong>Billing</strong> in your dashboard, enter the code under
      &ldquo;Have a promo code?&rdquo; and the credits are added straight away.</p>
      ${link ? `<p><a href="${escapeHtml(link)}" style="color:#0f172a">Open billing</a></p>` : ''}
      <p style="color:#64748b;font-size:13px">Keep this email — the code cannot be sent again.</p>
    </div>
  `.trim();

  return { subject, html, text };
}

/**
 * Resolves a tenant's owner address, if a tenant was named, and merges it with
 * any explicitly typed addresses. Duplicates are collapsed so one person does
 * not get the same code twice.
 */
export async function resolvePromoRecipients(params: {
  admin: SupabaseClient;
  tenantId?: string | null;
  emails?: string[] | null;
}): Promise<string[]> {
  const recipients = new Set<string>();

  for (const email of params.emails ?? []) {
    const trimmed = email.trim();
    if (trimmed) recipients.add(trimmed.toLowerCase());
  }

  if (params.tenantId) {
    const owner = await resolveTenantOwner(params.admin, params.tenantId);
    if (owner?.email) recipients.add(owner.email.trim().toLowerCase());
  }

  return [...recipients];
}

/**
 * Sends to each recipient separately rather than one message with many
 * addresses: a promo code is not something one tenant should see another
 * tenant receiving.
 */
export async function deliverPromoCode(params: {
  recipients: string[];
  code: string;
  campaign: string;
  amountCredits: number;
  expiresAt?: string | null;
}): Promise<PromoDeliveryOutcome> {
  if (params.recipients.length === 0) {
    return { attempted: false, sentTo: [], failed: [] };
  }

  const { subject, html, text } = buildPromoEmail(params);
  const sentTo: string[] = [];
  const failed: Array<{ email: string; error: string }> = [];

  for (const email of params.recipients) {
    try {
      const result = await sendTransactionalEmail({ to: email, subject, html, text });
      if (result.success && !result.suppressed) {
        sentTo.push(email);
      } else {
        failed.push({ email, error: result.error ?? (result.suppressed ? 'suppressed' : 'unknown') });
      }
    } catch (err) {
      failed.push({ email, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { attempted: true, sentTo, failed };
}
