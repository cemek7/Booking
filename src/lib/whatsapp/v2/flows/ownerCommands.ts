/**
 * Owner Command Processor
 *
 * Handles messages from role='owner' or role='staff' when current_flow='managing'.
 * All commands are LLM-driven — no hardcoded per-command patterns.
 *
 * Receives either a RuleMatch (from L1) or an AIResponse (from L2/L3)
 * and executes the appropriate action or sends the reply.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { executeAction, type AIResponse } from '@/lib/booking/action-validator';
import { findByIdempotencyKey, logAiAction } from '@/lib/ai/aiActionLog';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';
import { updateConversation, ConvState, ConvChannel } from '../conversationState';
import type { RuleMatch } from '@/lib/ai/rulesEngine';
import { ANALYTICS_EVENTS } from '@/lib/analytics/events';
import { captureServerAnalyticsEvent } from '@/lib/analytics/server';
import { getCapabilityForAction, hasCapability } from '@/lib/booking/capabilityMap';
import { createHash } from 'crypto';
import { parseNairaAmount } from '@/lib/ai/parseNairaAmount';

const supabaseAdmin = createSupabaseAdminClient();

type ServiceListRow = {
  name: string | null;
  price: number | string | null;
  duration: number | null;
};

type StaffListRow = {
  phone: string | null;
  role: string | null;
};

type OwnerAIResponse = AIResponse & {
  idempotency_key?: string;
  requires_confirmation?: boolean;
};

function getTenantSettings(row: { metadata?: unknown; tone_config?: unknown } | null): Record<string, unknown> {
  return {
    ...((row?.metadata as Record<string, unknown> | null) ?? {}),
    tone_config: row?.tone_config ?? null,
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Processes an owner/staff message.
 * Returns the reply string to send back to the owner.
 */
export async function handleOwnerCommand(
  phone: string,
  tenantId: string,
  input: RuleMatch | AIResponse,
  conv: ConvState,
  rawMessage: string
): Promise<string> {
  // Resolve the channel-aware conversation key.
  const convChannel: ConvChannel = conv.channel ?? 'whatsapp';
  const convExternalId: string = conv.external_id ?? phone;

  // ── L1 match ──────────────────────────────────────────────────────────────
  if ('confidence' in input && !('action' in input && typeof (input as AIResponse).reply === 'string')) {
    const rule = input as RuleMatch;
    return handleRuleMatch(convExternalId, tenantId, rule, conv, convChannel);
  }

  // ── AI response ───────────────────────────────────────────────────────────
  const aiResp = normalizeMoneyParams(input as AIResponse);
  const commandResponse = aiResp as OwnerAIResponse;
  const actionCapability = getCapabilityForAction(commandResponse.action);
  const role = conv.role ?? 'owner';
  const writeAction = isWriteAction(commandResponse.action);
  const idempotencyKey = getIdempotencyKey(tenantId, convExternalId, rawMessage, commandResponse, writeAction);

  await captureServerAnalyticsEvent({
    event: ANALYTICS_EVENTS.OWNER_COMMAND_USED,
    properties: {
      tenant_id: tenantId,
      channel: convChannel,
      flow: 'owner_command',
      metadata: {
        action: aiResp.action,
        confidence: aiResp.confidence,
        message_length: rawMessage.length,
      },
    },
    distinctId: convExternalId,
  });

  // Walk-in: execute immediately — no confirmation needed, customer is present
  if (aiResp.action === 'walk_in') {
    const execResult = await executeAction(tenantId, aiResp, { customerPhone: convExternalId });
    await logAiAction(supabaseAdmin, {
      tenantId,
      actorType: role,
      channel: convChannel,
      rawMessage,
      action: aiResp.action,
      params: aiResp.params,
      idempotencyKey,
      validationResult: { success: execResult.success },
      outcome: execResult.success ? 'executed' : 'rejected',
      model: 'owner-command',
    });
    if (!execResult.success) {
      return execResult.error ?? 'Could not record the walk-in. Please try again.';
    }
    return aiResp.reply;
  }

  if (writeAction) {
    const existing = await findByIdempotencyKey(supabaseAdmin, tenantId, idempotencyKey).catch(() => null);
    if (existing) {
      return 'I already handled that command.';
    }
  }

  if (actionCapability && !hasCapability(role, actionCapability)) {
    await recordBusinessEvent(supabaseAdmin, {
      tenantId,
      actorType: role === 'staff' ? 'staff' : 'user',
      actorId: null,
      action: BUSINESS_EVENT_ACTIONS.COMMAND_DENIED,
      entityType: 'ai_action',
      entityId: commandResponse.action,
      source: 'whatsapp',
      metadata: { capability: actionCapability, role, params: commandResponse.params },
    });
    await logAiAction(supabaseAdmin, {
      tenantId,
      actorType: role,
      channel: convChannel,
      rawMessage,
      action: commandResponse.action,
      params: commandResponse.params,
      idempotencyKey,
      validationResult: { denied_capability: actionCapability },
      outcome: 'denied',
      model: 'owner-command',
    });
    return 'You are not permitted to run that command.';
  }

  // If AI wants confirmation before executing a write action, store pending action
  if (writeAction && conv.flow_data?.awaiting_confirmation !== true) {
    commandResponse.idempotency_key = idempotencyKey;
    await updateConversation(convExternalId, tenantId, {
      flow_data: {
        ...conv.flow_data,
        pending_action: commandResponse,
        awaiting_confirmation: true,
      },
    }, convChannel);
    await logAiAction(supabaseAdmin, {
      tenantId,
      actorType: role,
      channel: convChannel,
      rawMessage,
      action: commandResponse.action,
      params: commandResponse.params,
      idempotencyKey,
      validationResult: { awaiting_confirmation: true },
      outcome: 'needs_confirmation',
      model: 'owner-command',
    });
    // Return the AI's confirmation message
    return aiResp.reply;
  }

  // Execute immediately for read-only and message actions
  if (!writeAction) {
    const result = await executeReadAction(tenantId, aiResp);
    await logAiAction(supabaseAdmin, {
      tenantId,
      actorType: role,
      channel: convChannel,
      rawMessage,
      action: commandResponse.action,
      params: commandResponse.params,
      idempotencyKey,
      validationResult: { read: true },
      outcome: 'executed',
      model: 'owner-command',
    });
    return result ?? aiResp.reply;
  }

  // Write confirmed (this path: awaiting_confirmation=true, AI response is confirming)
  const execResult = await executeAction(tenantId, aiResp, { customerPhone: convExternalId });
  await updateConversation(convExternalId, tenantId, {
    flow_data: {
      ...conv.flow_data,
      pending_action: null,
      awaiting_confirmation: false,
    },
  }, convChannel);

  await logAiAction(supabaseAdmin, {
    tenantId,
    actorType: role,
    channel: convChannel,
    rawMessage,
    action: commandResponse.action,
    params: commandResponse.params,
    idempotencyKey: `${idempotencyKey}:read`,
    validationResult: { success: execResult.success },
    outcome: execResult.success ? 'executed' : 'rejected',
    model: 'owner-command',
  });

  if (!execResult.success) {
    return `Something went wrong: ${execResult.error ?? 'unknown error'}. Please try again.`;
  }

  return aiResp.reply;
}

// ─── L1 rule handler ──────────────────────────────────────────────────────────

async function handleRuleMatch(
  externalId: string,
  tenantId: string,
  rule: RuleMatch,
  conv: ConvState,
  channel: ConvChannel = 'whatsapp'
): Promise<string> {
  switch (rule.action) {
    case 'greet':
      return getOwnerGreeting(tenantId);

    case 'help':
      return getOwnerHelp(tenantId);

    case 'affirm': {
      // Confirm pending action
      const pending = conv.flow_data?.pending_action as OwnerAIResponse | null;
      if (!pending) return 'What would you like to do?';

      const pendingIdempotencyKey = pending.idempotency_key ?? getIdempotencyKey(tenantId, externalId, pending.reply, pending);
      const existing = await findByIdempotencyKey(supabaseAdmin, tenantId, pendingIdempotencyKey).catch(() => null);
      if (existing?.outcome === 'executed') {
        await updateConversation(externalId, tenantId, {
          flow_data: { ...conv.flow_data, pending_action: null, awaiting_confirmation: false },
        }, channel);
        return 'I already handled that command.';
      }

      const result = await executeAction(tenantId, pending, { customerPhone: externalId });
      await updateConversation(externalId, tenantId, {
        flow_data: { ...conv.flow_data, pending_action: null, awaiting_confirmation: false },
      }, channel);

      await logAiAction(supabaseAdmin, {
        tenantId,
        actorType: conv.role ?? 'owner',
        channel,
        rawMessage: null,
        action: pending.action,
        params: pending.params,
        idempotencyKey: pendingIdempotencyKey,
        validationResult: { confirmed: true, success: result.success },
        outcome: result.success ? 'executed' : 'rejected',
        model: 'owner-command',
      });

      return result.success
        ? `Done! ${pending.reply}`
        : `Couldn't complete that: ${result.error ?? 'unknown error'}`;
    }

    case 'negate': {
      await updateConversation(externalId, tenantId, {
        flow_data: { ...conv.flow_data, pending_action: null, awaiting_confirmation: false },
      }, channel);
      return 'Ok, cancelled. What else can I help with?';
    }

    case 'select_option': {
      const options = conv.flow_data?.option_list as string[] | undefined;
      const idx = (rule.params?.optionIndex ?? 1) - 1;
      if (options && options[idx]) {
        return `You selected: ${options[idx]}. What would you like to do with it?`;
      }
      return 'What would you like to do?';
    }

    default:
      return 'What would you like to do?';
  }
}

// ─── Read action executor ─────────────────────────────────────────────────────

async function executeReadAction(
  tenantId: string,
  aiResp: AIResponse
): Promise<string | null> {
  const { action } = aiResp;

  switch (action) {
    case 'owner_query':
    case 'get_insights': {
      // Return the AI-formatted reply (the AI already composed the answer from the context)
      return null; // use aiResp.reply
    }

    case 'list_services': {
      const { data } = await supabaseAdmin
        .from('services')
        .select('name, price, duration')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('sort_order');
      if (!data?.length) return 'No services found. Add one with: "Add [service] at [price]"';
      const lines = (data as ServiceListRow[]).map(
        (s: ServiceListRow) =>
          `  • ${s.name} — ₦${Math.round(Number(s.price ?? 0)).toLocaleString()} (${s.duration ?? 60}min)`
      );
      return `Your services:\n${lines.join('\n')}`;
    }

    case 'list_staff': {
      const { data } = await supabaseAdmin
        .from('tenant_users')
        .select('phone, role, services_all')
        .eq('tenant_id', tenantId)
        .in('role', ['staff', 'owner']);
      if (!data?.length) return 'No staff found.';
      const lines = (data as StaffListRow[]).map(
        (s: StaffListRow) => `  • ${s.phone ?? 'Unknown'} (${s.role})`
      );
      return `Your team:\n${lines.join('\n')}`;
    }

    default:
      return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isWriteAction(action: string): boolean {
  return [
    'create_booking', 'cancel_booking', 'reschedule_booking', 'mark_no_show',
    'add_service', 'update_service', 'add_staff', 'update_schedule', 'block_slot',
    'add_product', 'adjust_stock', 'set_price', 'set_availability',
    'record_retail_sale', 'refund_sale', 'record_outstanding_balance',
    'create_order', 'set_order_fulfillment', 'add_delivery_fee', 'cancel_order_restock',
    'add_customer_note', 'set_customer_tag', 'set_staff_capability',
  ].includes(action);
}

function getIdempotencyKey(
  tenantId: string,
  externalId: string,
  rawMessage: string,
  aiResp: OwnerAIResponse,
  deterministic: boolean
): string {
  if (typeof aiResp.idempotency_key === 'string' && aiResp.idempotency_key.trim()) {
    return aiResp.idempotency_key.trim();
  }

  const base = createHash('sha256')
    .update(JSON.stringify({
      tenantId,
      externalId,
      action: aiResp.action,
      params: aiResp.params,
      rawMessage: rawMessage.trim().toLowerCase(),
    }))
    .digest('hex');

  return deterministic ? base : `${base}:${Date.now()}`;
}

function normalizeMoneyParams(aiResp: AIResponse): AIResponse {
  const keys = [
    'price',
    'price_cents',
    'unit_price_cents',
    'delivery_fee',
    'delivery_fee_cents',
    'discount',
    'discount_cents',
    'amount',
    'amount_cents',
  ];

  const params = { ...aiResp.params };
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string') {
      const parsed = parseNairaAmount(value);
      if (parsed !== null) {
        params[key.endsWith('_cents') ? key : `${key}_cents`] = parsed;
      }
    }
  }

  return {
    ...aiResp,
    params,
  };
}

async function getOwnerGreeting(tenantId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('tenants')
    .select('name, metadata, tone_config')
    .eq('id', tenantId)
    .maybeSingle();
  const name = data?.name ?? 'your business';
  return `Hi! Managing *${name}*. What can I do for you?\n\nTry:\n  • "Who's booked today?"\n  • "Block tomorrow afternoon"\n  • "How was this week?"\n  • "Add a new service"`;
}

async function getOwnerHelp(tenantId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('tenants')
    .select('metadata, tone_config')
    .eq('id', tenantId)
    .maybeSingle();
  const settings = getTenantSettings(data);
  const bookingNoun = String(settings.booking_noun ?? 'booking');
  const staffTitle = String(settings.staff_title ?? 'staff');

  return `Here's what you can ask me:\n\n*Schedule*\n  • "Who's booked today/tomorrow/this week?"\n  • "What's [${staffTitle}]'s schedule this week?"\n  • "Block [date/time] for [${staffTitle}]"\n  • "Walk-in [${staffTitle}] [service]"\n\n*${bookingNoun.charAt(0).toUpperCase() + bookingNoun.slice(1)}s*\n  • "Cancel [customer]'s ${bookingNoun}"\n  • "Move [customer] to [new time]"\n  • "Mark [customer] as no-show"\n\n*Products & Orders*\n  • "Add [product] at ₦[price]"\n  • "Restock [product] by [qty]"\n  • "Record retail sale for ₦[amount]"\n  • "Refund retail order [id]"\n  • "Add delivery fee of ₦[amount] to order [id]"\n\n*Customers & Team*\n  • "Show lapsed customers"\n  • "Tag customer [name] as wholesale"\n  • "Add note for [customer]"\n  • "Show ${staffTitle} sales this week"\n\n*Reports*\n  • "How was today/this week?"\n  • "Who are my top customers?"`;
}
