/**
 * Owner Command Processor
 *
 * Handles messages from role='owner' or role='staff' when current_flow='managing'.
 * All commands are LLM-driven — no hardcoded per-command patterns.
 *
 * Receives either a RuleMatch (from L1) or an AIResponse (from L2/L3)
 * and executes the appropriate action or sends the reply.
 */

import { createClient } from '@supabase/supabase-js';
import { executeAction, AIResponse } from '../actionValidator';
import { updateConversation, ConvState } from '../conversationState';
import type { RuleMatch } from '@/lib/ai/rulesEngine';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
  // ── L1 match ──────────────────────────────────────────────────────────────
  if ('confidence' in input && !('action' in input && typeof (input as AIResponse).reply === 'string')) {
    const rule = input as RuleMatch;
    return handleRuleMatch(phone, tenantId, rule, conv);
  }

  // ── AI response ───────────────────────────────────────────────────────────
  const aiResp = input as AIResponse;

  // Walk-in: execute immediately — no confirmation needed, customer is present
  if (aiResp.action === 'walk_in') {
    const execResult = await executeAction(tenantId, aiResp, { customerPhone: phone });
    if (!execResult.success) {
      return execResult.error ?? 'Could not record the walk-in. Please try again.';
    }
    return aiResp.reply;
  }

  // If AI wants confirmation before executing a write action, store pending action
  if (isWriteAction(aiResp.action) && conv.flow_data?.awaiting_confirmation !== true) {
    await updateConversation(phone, tenantId, {
      flow_data: {
        ...conv.flow_data,
        pending_action: aiResp,
        awaiting_confirmation: true,
      },
    });
    // Return the AI's confirmation message
    return aiResp.reply;
  }

  // Execute immediately for read-only and message actions
  if (!isWriteAction(aiResp.action)) {
    const result = await executeReadAction(tenantId, aiResp);
    return result ?? aiResp.reply;
  }

  // Write confirmed (this path: awaiting_confirmation=true, AI response is confirming)
  const execResult = await executeAction(tenantId, aiResp, { customerPhone: phone });
  await updateConversation(phone, tenantId, {
    flow_data: {
      ...conv.flow_data,
      pending_action: null,
      awaiting_confirmation: false,
    },
  });

  if (!execResult.success) {
    return `Something went wrong: ${execResult.error ?? 'unknown error'}. Please try again.`;
  }

  return aiResp.reply;
}

// ─── L1 rule handler ──────────────────────────────────────────────────────────

async function handleRuleMatch(
  phone: string,
  tenantId: string,
  rule: RuleMatch,
  conv: ConvState
): Promise<string> {
  switch (rule.action) {
    case 'greet':
      return getOwnerGreeting(tenantId);

    case 'help':
      return getOwnerHelp(tenantId);

    case 'affirm': {
      // Confirm pending action
      const pending = conv.flow_data?.pending_action as AIResponse | null;
      if (!pending) return 'What would you like to do?';

      const result = await executeAction(tenantId, pending, { customerPhone: phone });
      await updateConversation(phone, tenantId, {
        flow_data: { ...conv.flow_data, pending_action: null, awaiting_confirmation: false },
      });

      return result.success
        ? `Done! ${pending.reply}`
        : `Couldn't complete that: ${result.error ?? 'unknown error'}`;
    }

    case 'negate': {
      await updateConversation(phone, tenantId, {
        flow_data: { ...conv.flow_data, pending_action: null, awaiting_confirmation: false },
      });
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
  const { action, params } = aiResp;

  switch (action) {
    case 'owner_query':
    case 'get_insights': {
      // Return the AI-formatted reply (the AI already composed the answer from the context)
      return null; // use aiResp.reply
    }

    case 'list_services': {
      const { data } = await supabaseAdmin
        .from('services')
        .select('name, price_cents, duration_minutes')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('sort_order');
      if (!data?.length) return 'No services found. Add one with: "Add [service] at [price]"';
      const lines = data.map((s) => `  • ${s.name} — ₦${Math.round((s.price_cents ?? 0) / 100).toLocaleString()} (${s.duration_minutes ?? 60}min)`);
      return `Your services:\n${lines.join('\n')}`;
    }

    case 'list_staff': {
      const { data } = await supabaseAdmin
        .from('tenant_users')
        .select('phone, role, services_all')
        .eq('tenant_id', tenantId)
        .in('role', ['staff', 'owner']);
      if (!data?.length) return 'No staff found.';
      const lines = data.map((s) => `  • ${s.phone ?? 'Unknown'} (${s.role})`);
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
  ].includes(action);
}

async function getOwnerGreeting(tenantId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('tenants')
    .select('name, settings')
    .eq('id', tenantId)
    .maybeSingle();
  const name = data?.name ?? 'your business';
  return `Hi! Managing *${name}*. What can I do for you?\n\nTry:\n  • "Who's booked today?"\n  • "Block tomorrow afternoon"\n  • "How was this week?"\n  • "Add a new service"`;
}

async function getOwnerHelp(tenantId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle();
  const bookingNoun = data?.settings?.booking_noun ?? 'booking';
  const staffTitle = data?.settings?.staff_title ?? 'staff';

  return `Here's what you can ask me:\n\n*Schedule*\n  • "Who's booked today/tomorrow/this week?"\n  • "What's [${staffTitle}]'s schedule this week?"\n  • "Block [date/time] for [${staffTitle}]"\n  • "Walk-in [${staffTitle}] [service]"\n\n*${bookingNoun.charAt(0).toUpperCase() + bookingNoun.slice(1)}s*\n  • "Cancel [customer]'s ${bookingNoun}"\n  • "Move [customer] to [new time]"\n  • "Mark [customer] as no-show"\n\n*Services & ${staffTitle}s*\n  • "Change [service] price to [amount]"\n  • "Add [service] at [price]"\n  • "Add a new ${staffTitle} named [name]"\n\n*Reports*\n  • "How was today/this week?"\n  • "Who are my top customers?"`;
}
