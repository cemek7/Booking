import type { SupabaseClient } from "@supabase/supabase-js";
import { getTenantWhatsAppProviderClient } from "@/lib/whatsapp/providers/providerSelection";
import { defaultLogger } from "@/lib/logger";
import { siasOperations } from "@/lib/sias-operations";
import { sendGovernedInitiated } from "@/lib/whatsapp/v2/deliverability/governedSend";
import { loadConversationFlags } from "@/lib/whatsapp/v2/deliverability/conversationFlags";
import { toTemplateParameters } from "@/lib/whatsapp/v2/deliverability/templateParams";
import { brandCustomerText } from "@/lib/whatsapp/v2/outboundBranding";
import type { WhatsAppProviderClient } from "@/lib/whatsapp/providers/types";

export interface ReminderRunResult {
  processed: number;
  v2_reminders_sent: number;
  /** Dispositioned without delivery — opted out, or no approved template outside the window. */
  held: number;
}

const MAX_ATTEMPTS = 5;

/**
 * Hold reasons that will never resolve on their own. Retrying these every ten
 * minutes burns quota and still delivers nothing, so the reminder is closed out
 * and the real reason recorded instead of being left pending forever.
 */
const TERMINAL_HOLD_REASONS = new Set([
  "opted_out",
  "no_template_outside_window",
  "template_messaging_not_enabled",
  "paid_template_consent_required",
]);

interface ReminderOutcome {
  sent: boolean;
  /** True when no later attempt can succeed, whether or not the send happened. */
  terminal: boolean;
  reason: string;
}

/**
 * Send one reminder through the Meta send gate.
 *
 * Reminders used to call `sendTextMessage` directly. That is only legal inside
 * the 24-hour customer service window, and a reminder is by definition sent to
 * someone who booked days ago — so on the Cloud API those sends are rejected,
 * and the old code marked the reminder delivered anyway. Routing through
 * `sendGovernedInitiated` picks freeform inside the window, an approved
 * template outside it, and holds when neither is available.
 */
async function sendGovernedReminder(
  supabase: SupabaseClient,
  tenantId: string,
  client: WhatsAppProviderClient,
  recipient: string,
  messageType: string,
  text: string,
): Promise<ReminderOutcome> {
  const conv = await loadConversationFlags(supabase, tenantId, recipient);

  const result = await sendGovernedInitiated(supabase, {
    tenantId,
    recipient,
    messageType,
    lastInboundAt: conv.last_inbound_at,
    optedOutAt: conv.opted_out_at,
    buildFreeform: () => text,
    sendFreeform: async (body) => {
      const branded = await brandCustomerText(tenantId, recipient, body, {
        initiated: true,
        conv,
      });
      if (!branded) return false;
      const response = await client.sendTextMessage(recipient, branded);
      return response.success;
    },
    sendTemplate: async (name, language, paramMapping) => {
      if (!client.sendTemplateMessage) return false;
      const response = await client.sendTemplateMessage(
        recipient,
        name,
        toTemplateParameters(paramMapping),
        language,
      );
      return response.success;
    },
  });

  return {
    sent: result.sent,
    terminal: result.sent || TERMINAL_HOLD_REASONS.has(result.reason),
    reason: result.reason,
  };
}

/**
 * Never throws. A claimed reminder row sits at status 'processing', and the
 * claim query only ever picks up 'pending' — so an exception escaping here
 * would strand that reminder permanently. Any error is a transient failure.
 */
async function trySendGovernedReminder(
  supabase: SupabaseClient,
  tenantId: string,
  client: WhatsAppProviderClient,
  recipient: string,
  messageType: string,
  text: string,
): Promise<ReminderOutcome> {
  try {
    return await sendGovernedReminder(
      supabase,
      tenantId,
      client,
      recipient,
      messageType,
      text,
    );
  } catch (err) {
    defaultLogger.error(`Reminder send threw for ${messageType}`, err);
    return { sent: false, terminal: false, reason: "send_threw" };
  }
}

/**
 * Batch-resolve customer display names for a set of reservation customer_ids.
 * reservations stores the phone as `customer_number`; the name lives on `customers`
 * (customer_name / name), reachable via reservations.customer_id.
 */
async function fetchCustomerNames(
  supabase: SupabaseClient,
  customerIds: Array<string | null | undefined>,
): Promise<Map<string, string | null>> {
  const ids = [...new Set(customerIds.filter((v): v is string => !!v))];
  const names = new Map<string, string | null>();
  if (ids.length === 0) return names;
  const { data } = await supabase
    .from("customers")
    .select("id, customer_name, name")
    .in("id", ids);
  for (const c of data ?? []) {
    names.set(c.id, c.customer_name ?? c.name ?? null);
  }
  return names;
}

/**
 * Process and send a single tenant's pending reminders.
 *
 * 1. Atomically claims pending `reminders` rows (status pending -> processing) and sends them.
 * 2. Runs the v2 reservation reminder pass (24h / 2h flags on confirmed reservations).
 *
 * Every send goes through the Meta send gate, so a reminder is only ever marked
 * delivered when the provider actually accepted it.
 *
 * Tenant scoping is enforced by the explicit `.eq('tenant_id', tenantId)` on every query, so this is
 * safe to call with either an RLS-scoped route client (session path: /api/reminders/run) or a
 * service-role admin client (cron path: /api/cron/reminders iterating all tenants).
 */
export async function runRemindersForTenant(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ReminderRunResult> {
  const now = new Date().toISOString();

  // Atomically claim pending reminders via optimistic locking:
  // UPDATE status to 'processing' WHERE status='pending', then SELECT.
  // This prevents concurrent invocations from sending duplicate reminders.
  const { data: rows, error } = await supabase
    .from("reminders")
    .update({ status: "processing" })
    .eq("tenant_id", tenantId)
    .lte("remind_at", now)
    .eq("status", "pending")
    .limit(100)
    .select("id,reservation_id,method,raw,attempts");

  if (error) throw new Error("Failed to fetch reminders");

  let processed = 0;
  let held = 0;

  const client = await getTenantWhatsAppProviderClient(tenantId);

  for (const r of rows ?? []) {
    try {
      const { id, raw, attempts } = r;
      const toNumber = raw?.to || raw?.phone || null;
      const message = raw?.message || "Reminder: you have an upcoming booking.";

      if (!toNumber) {
        // Mark as failed when no phone number is available
        const { error: failedUpdateError } = await supabase
          .from("reminders")
          .update({ status: "failed", attempts: (attempts || 0) + 1 })
          .eq("id", id);
        if (failedUpdateError) {
          defaultLogger.error(
            `Failed to mark reminder ${id} as failed:`,
            failedUpdateError,
          );
        }
        continue;
      }

      const outcome: ReminderOutcome = client
        ? await trySendGovernedReminder(
            supabase,
            tenantId,
            client,
            toNumber,
            "booking_reminder",
            message,
          )
        : {
            sent: false,
            terminal: false,
            reason: "whatsapp_provider_unavailable",
          };

      const reason = raw?.reason ?? raw?.label ?? "scheduled";

      if (outcome.sent) {
        await siasOperations.recordCampaignRun({
          tenantId,
          campaignType: "reminder",
          action: "send_reminder",
          targetPhone: toNumber,
          sourceEvent: "reminder.run",
          status: "sent",
          metadata: { reminder_id: id, reason },
          attribution: {
            signal: "no_show_reduction",
            source_event: "reminder.run",
          },
        });

        const { error: updateError } = await supabase
          .from("reminders")
          .update({ status: "sent" })
          .eq("id", id);

        if (!updateError) {
          processed += 1;
        }
        continue;
      }

      if (outcome.terminal) {
        // Nothing will change on a retry. Close the row out and keep the real
        // reason where it can be read back, rather than reporting a delivery.
        held += 1;
        await siasOperations.recordCampaignRun({
          tenantId,
          campaignType: "reminder",
          action: "send_reminder",
          targetPhone: toNumber,
          sourceEvent: "reminder.run",
          status: "cancelled",
          metadata: { reminder_id: id, reason, hold_reason: outcome.reason },
          attribution: {
            signal: "no_show_reduction",
            source_event: "reminder.run",
          },
        });

        const { error: holdUpdateError } = await supabase
          .from("reminders")
          .update({
            status: "failed",
            attempts: MAX_ATTEMPTS,
            raw:
              raw && typeof raw === "object" && !Array.isArray(raw)
                ? { ...raw, hold_reason: outcome.reason }
                : { hold_reason: outcome.reason },
          })
          .eq("id", id);
        if (holdUpdateError) {
          defaultLogger.error(
            `Failed to close held reminder ${id}:`,
            holdUpdateError,
          );
        }
        continue;
      }

      const newAttempts = (attempts || 0) + 1;
      await siasOperations.recordCampaignRun({
        tenantId,
        campaignType: "reminder",
        action: "send_reminder",
        targetPhone: toNumber,
        sourceEvent: "reminder.run",
        status: newAttempts >= MAX_ATTEMPTS ? "failed" : "retry_scheduled",
        maxAttempts: MAX_ATTEMPTS,
        metadata: {
          reminder_id: id,
          reason,
          attempts: newAttempts,
          hold_reason: outcome.reason,
        },
        attribution: {
          signal: "no_show_reduction",
          source_event: "reminder.run",
        },
      });

      const { error: retryUpdateError } = await supabase
        .from("reminders")
        .update({
          attempts: newAttempts,
          status: newAttempts >= MAX_ATTEMPTS ? "failed" : "pending",
        })
        .eq("id", id);
      if (retryUpdateError) {
        defaultLogger.error(
          `Failed to update attempts for reminder ${id}:`,
          retryUpdateError,
        );
      }
    } catch {
      // Continue processing other reminders
      continue;
    }
  }

  // ── v2 reminder pass: reservations with unsent reminder flags ──────────
  let v2processed = 0;

  if (client) {
    // 24h reminders — reservations.customer_number is the phone; name comes from customers.
    const { data: due24h } = await supabase
      .from("reservations")
      .select("id, customer_id, customer_number, start_at, service_id")
      .eq("tenant_id", tenantId)
      .eq("reminder_24h_sent", false)
      .eq("status", "confirmed")
      .gte("start_at", new Date(Date.now() + 23 * 3600_000).toISOString())
      .lte("start_at", new Date(Date.now() + 25 * 3600_000).toISOString());

    const names24h = await fetchCustomerNames(
      supabase,
      (due24h ?? []).map((r) => r.customer_id),
    );

    for (const r of due24h ?? []) {
      if (!r.customer_number) continue;
      const name = names24h.get(r.customer_id) ?? "there";
      const apptTime = new Date(r.start_at).toLocaleTimeString("en-NG", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const apptDate = new Date(r.start_at).toLocaleDateString("en-NG", {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
      const msg = `Hi ${name}, your appointment is tomorrow (${apptDate}) at ${apptTime}. Reply YES to confirm or CHANGE to reschedule.`;
      try {
        const outcome = await sendGovernedReminder(
          supabase,
          tenantId,
          client,
          r.customer_number,
          "reservation_reminder_24h",
          msg,
        );

        await siasOperations.recordCampaignRun({
          tenantId,
          campaignType: "reminder",
          action: "send_reminder",
          targetPhone: r.customer_number,
          targetBookingId: r.id,
          sourceEvent: "reservation.reminder_24h",
          status: outcome.sent
            ? "sent"
            : outcome.terminal
              ? "cancelled"
              : "retry_scheduled",
          metadata: {
            lead_time: "24h",
            service_id: r.service_id ?? null,
            ...(outcome.sent ? {} : { hold_reason: outcome.reason }),
          },
          attribution: {
            signal: "no_show_reduction",
            source_event: "reservation.reminder_24h",
          },
        });

        // The flag means "dispositioned", so it is set for a terminal hold too —
        // otherwise the same undeliverable reminder is retried every ten minutes
        // for two hours. A transient failure leaves it false so the next pass retries.
        if (outcome.terminal) {
          await supabase
            .from("reservations")
            .update({ reminder_24h_sent: true })
            .eq("id", r.id);
        }
        if (outcome.sent) v2processed++;
        else if (outcome.terminal) held++;
      } catch {
        /* continue */
      }
    }

    // 2h reminders
    const { data: due2h } = await supabase
      .from("reservations")
      .select("id, customer_id, customer_number, start_at, service_id")
      .eq("tenant_id", tenantId)
      .eq("reminder_2h_sent", false)
      .eq("status", "confirmed")
      .gte("start_at", new Date(Date.now() + 1.75 * 3600_000).toISOString())
      .lte("start_at", new Date(Date.now() + 2.25 * 3600_000).toISOString());

    for (const r of due2h ?? []) {
      if (!r.customer_number) continue;
      const apptTime = new Date(r.start_at).toLocaleTimeString("en-NG", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const msg = `Reminder: your appointment is in 2 hours at ${apptTime}. Can't make it? Reply CANCEL to free your slot.`;
      try {
        const outcome = await sendGovernedReminder(
          supabase,
          tenantId,
          client,
          r.customer_number,
          "reservation_reminder_2h",
          msg,
        );

        await siasOperations.recordCampaignRun({
          tenantId,
          campaignType: "reminder",
          action: "send_reminder",
          targetPhone: r.customer_number,
          targetBookingId: r.id,
          sourceEvent: "reservation.reminder_2h",
          status: outcome.sent
            ? "sent"
            : outcome.terminal
              ? "cancelled"
              : "retry_scheduled",
          metadata: {
            lead_time: "2h",
            service_id: r.service_id ?? null,
            ...(outcome.sent ? {} : { hold_reason: outcome.reason }),
          },
          attribution: {
            signal: "no_show_reduction",
            source_event: "reservation.reminder_2h",
          },
        });

        if (outcome.terminal) {
          await supabase
            .from("reservations")
            .update({ reminder_2h_sent: true })
            .eq("id", r.id);
        }
        if (outcome.sent) v2processed++;
        else if (outcome.terminal) held++;
      } catch {
        /* continue */
      }
    }
  }

  return { processed, v2_reminders_sent: v2processed, held };
}
