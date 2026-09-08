import type { SupabaseClient } from '@supabase/supabase-js';
import { checkRateCard, type RateCardWarning } from '@/lib/billing/rateCardWatch';
import { getMeteringMode } from '@/lib/billing/messageRates';

/**
 * Platform-level things a superadmin must not miss.
 *
 * These exist because every one of them fails SILENTLY. An unconfirmed rate
 * card, a stale naira, an unpaid Meta account — nothing breaks, no error is
 * thrown, no tenant complains. The margin is simply wrong, or the messages
 * simply stop, and the first signal is commercial damage. A log line nobody
 * reads is not a control; the dashboard is.
 */

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface PlatformAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  /** What to actually do about it. */
  action?: string;
}

/** Meta stops delivering service messages without a payment method on file. */
export const META_PAYMENT_DEADLINE = '2026-09-30T23:59:59Z';
/** Per-message charging begins. */
export const METERING_CUTOVER = '2026-10-01T00:00:00Z';

export function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

export interface PlatformAlertInputs {
  rateCard: RateCardWarning[];
  meteringMode: 'shadow' | 'live';
  rateConfigured: boolean;
  paymentMethodOnFile: boolean;
  now: Date;
}

/** Pure, so the severity rules can be tested without a database or a clock. */
export function buildPlatformAlerts(input: PlatformAlertInputs): PlatformAlert[] {
  const alerts: PlatformAlert[] = [];
  const { now } = input;

  // ── Meta payment method ────────────────────────────────────────────────────
  // The most consequential item on the list: without it every tenant's
  // assistant goes silent at once, on a known date, with no warning from Meta.
  if (!input.paymentMethodOnFile) {
    const daysLeft = daysBetween(now, new Date(META_PAYMENT_DEADLINE));
    alerts.push({
      id: 'meta_payment_method',
      severity: daysLeft <= 14 ? 'critical' : 'warning',
      title: daysLeft < 0
        ? 'Meta payment method is overdue'
        : `Meta payment method: ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`,
      message: daysLeft < 0
        ? 'The deadline has passed. Meta may already have stopped delivering service '
          + 'messages, which silences every tenant’s assistant at once.'
        : 'Meta stops delivering service messages from 2026-10-01 for any provider '
          + 'without a payment method on the WhatsApp Business Account.',
      action: 'Add a payment method in Meta Business Manager, then set '
        + 'BOOKA_META_PAYMENT_METHOD_ON_FILE=true.',
    });
  }

  // ── Metering cutover ───────────────────────────────────────────────────────
  const daysToCutover = daysBetween(now, new Date(METERING_CUTOVER));
  if (input.meteringMode === 'shadow' && daysToCutover <= 0) {
    alerts.push({
      id: 'metering_shadow_after_cutover',
      severity: 'critical',
      title: 'Metering is still in shadow mode',
      message: 'Meta is charging Booka for these messages and no tenant is being billed '
        + 'for them. Every message sent since the cutover is absorbed cost.',
      action: 'Set BOOKA_MESSAGE_METERING_MODE=live.',
    });
  }
  if (input.meteringMode === 'live' && !input.rateConfigured) {
    alerts.push({
      id: 'metering_live_no_rate',
      severity: 'warning',
      title: 'Metering is live on a fallback rate',
      message: 'Tenants are being charged from the compiled-in provisional rate rather '
        + 'than a confirmed one.',
      action: 'Confirm Meta’s published rate and add it to the rate card.',
    });
  }

  // ── Cost basis ─────────────────────────────────────────────────────────────
  for (const w of input.rateCard) {
    alerts.push({
      id: `rate_card_${w.kind}`,
      // A quarter boundary is a deadline; the others are drift.
      severity: w.kind === 'quarter_unconfirmed' ? 'warning' : 'warning',
      title: w.kind === 'quarter_unconfirmed'
        ? `Meta can change prices on ${w.effectiveOn}`
        : w.kind === 'fx_stale'
          ? 'The naira rate is stale'
          : 'No rate card — pricing is on fallback constants',
      message: w.message,
      action: w.kind === 'fx_stale'
        ? 'Check the fx-rate worker is scheduled.'
        : 'Add the confirmed rates to message_rate_card.',
    });
  }

  const rank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Reads current state and builds the list. Never throws. */
export async function getPlatformAlerts(
  admin: SupabaseClient,
  now: Date = new Date(),
): Promise<PlatformAlert[]> {
  const rateCard = await checkRateCard(admin, now);
  const attested = process.env.BOOKA_META_PAYMENT_METHOD_ON_FILE;
  return buildPlatformAlerts({
    rateCard,
    meteringMode: getMeteringMode(),
    rateConfigured: !!process.env.BOOKA_MESSAGE_RATE_CREDITS,
    paymentMethodOnFile: !!attested && attested !== 'false',
    now,
  });
}
