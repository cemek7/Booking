/**
 * v2 Message Pipeline — Main Orchestrator
 *
 * Processes a single (possibly batched) message through the 3-layer AI stack:
 *   L1: Rules engine (5 universal signal patterns)
 *   L2: Gemini Flash-Lite (all business-specific intent)
 *   L3: Gemini Flash (complex/ambiguous escalations)
 *
 * Called by the Vercel cron worker (src/app/api/worker/whatsapp/route.ts).
 */

import { createClient } from '@supabase/supabase-js';
import { normalizePidgin, matchRule } from '@/lib/ai/rulesEngine';
import { isQuotaExceeded, recordAIUsage } from '@/lib/ai/quotaTracker';
import { getConversation, ensureConversation } from './conversationState';
import type { ConvChannel } from './conversationState';
import { claimBatch } from './messageBatcher';
import { validateAction, AIResponse } from './actionValidator';
import { getTenantWhatsAppConfig } from '@/lib/whatsapp/evolutionClient';
import { getProviderClient } from '@/lib/whatsapp/providers';
import type { EvolutionAPIConfig } from '@/lib/whatsapp/evolutionClient';
import type { ProviderConfig } from '@/lib/whatsapp/providers';
import { callGoogleAI } from '@/lib/google-ai';
import { callOpenRouter } from '@/lib/openrouter';
import { estimatePromptTokens, withTenantWalletSpend } from '@/lib/billing/ai-wallet';
import { looksLikeShowcaseRequest, sendShowcasePack } from '@/lib/whatsapp/showcasePackService';
import { handleOwnerCommand } from './flows/ownerCommands';
import { handleOnboarding } from './flows/ownerOnboarding';
import { handleCustomerBooking } from './flows/customerBooking';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FLASH_LITE_MODEL = 'gemini-2.0-flash-lite';
const FLASH_MODEL = 'gemini-2.0-flash';
const MAX_AI_RETRIES = 2;
const OPENROUTER_V2_MODEL =
  process.env.OPENROUTER_DEFAULT_MODEL ||
  process.env.OPENROUTER_FALLBACK_MODEL ||
  'meta-llama/llama-3.1-8b-instruct:free';
const OPENROUTER_V2_FALLBACK_MODELS = (process.env.OPENROUTER_V2_FALLBACK_MODELS || '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const V2_AI_PROVIDER = (process.env.WHATSAPP_V2_AI_PROVIDER || 'auto').toLowerCase();
const V2_DISABLE_GOOGLE = process.env.WHATSAPP_V2_DISABLE_GOOGLE === 'true';

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Processes a single (possibly batched) inbound message through the v2 AI pipeline.
 *
 * The trailing `channel` param defaults to `'whatsapp'` so all existing callers
 * are unaffected (byte-for-byte WhatsApp behaviour is preserved).
 * When channel='instagram', the conversation is keyed on the Instagram Scoped ID
 * (IGSID) rather than a phone number, and outbound replies are routed through
 * the Instagram adapter (getTenantInstagramConfig + getProviderClient).
 */
export async function processMessageV2(
  externalId: string,
  tenantId: string,
  message: string,
  messageId: string,
  channel: ConvChannel = 'whatsapp'
): Promise<boolean> {
  // ── 1. Check if more messages are still arriving ───────────────────────────
  const batch = await claimBatch(externalId, tenantId, channel);
  if (!batch) return false; // Still accumulating — skip this cycle

  const rawMessage = batch.combined;
  const normalized = normalizePidgin(rawMessage);

  // ── 2. Load conversation state ─────────────────────────────────────────────
  let conv = await getConversation(externalId, tenantId, channel);
  if (!conv) {
    conv = await ensureConversation(externalId, tenantId, 'unknown', channel);
  }

  // ── 3. Route to appropriate flow handler ──────────────────────────────────
  // Owner onboarding is handled separately from the main pipeline
  if (conv.current_flow === 'onboarding' || (conv.role === 'owner' && conv.current_flow === 'idle' && !await isTenantActivated(tenantId))) {
    await handleOnboarding(externalId, tenantId, normalized, conv);
    return true;
  }

  if (conv.role === 'owner' || conv.role === 'staff') {
    await handleOwnerOrStaffMessage(externalId, tenantId, normalized, conv, messageId, batch.messageIds, channel);
    return true;
  }

  // Customer path
  await handleCustomerMessage(externalId, tenantId, normalized, conv, messageId, batch.messageIds, channel);
  return true;
}

// ─── Owner / staff message handler ───────────────────────────────────────────

async function handleOwnerOrStaffMessage(
  externalId: string,
  tenantId: string,
  message: string,
  conv: Awaited<ReturnType<typeof getConversation>> & object,
  messageId: string,
  allMessageIds: string[],
  channel: ConvChannel = 'whatsapp'
): Promise<void> {
  const providerConfig = await resolveProviderConfig(tenantId, channel);

  // L1 check — yes/no/numbers for confirming AI-proposed actions
  const l1Match = matchRule(message, {
    current_flow: conv!.current_flow,
    flow_step: conv!.flow_step,
    awaiting_selection: conv!.flow_data?.awaiting_selection ?? false,
  });

  if (l1Match) {
    const reply = await handleOwnerCommand(externalId, tenantId, l1Match, conv!, message);
    if (reply) {
      await sendReplyByChannel(providerConfig, tenantId, externalId, reply, channel);
      await markMessagesProcessed(allMessageIds);
    }
    return;
  }

  // L2 for owner commands
  const aiReply = await callAIWithRetry(tenantId, message, conv!, 'owner', messageId);
  if (!aiReply) {
    await sendReplyByChannel(
      providerConfig,
      tenantId,
      externalId,
      'Sorry, I had trouble understanding that. Try again or type *help* for options.',
      channel
    );
    return;
  }

  const reply = await handleOwnerCommand(externalId, tenantId, aiReply, conv!, message);
  if (reply) {
    await sendReplyByChannel(providerConfig, tenantId, externalId, reply, channel);
  }

  await markMessagesProcessed(allMessageIds);
}

// ─── Customer message handler ─────────────────────────────────────────────────

async function handleCustomerMessage(
  externalId: string,
  tenantId: string,
  message: string,
  conv: Awaited<ReturnType<typeof getConversation>> & object,
  messageId: string,
  allMessageIds: string[],
  channel: ConvChannel = 'whatsapp'
): Promise<void> {
  const providerConfig = await resolveProviderConfig(tenantId, channel);

  // L1 check
  const l1Match = matchRule(message, {
    current_flow: conv!.current_flow,
    flow_step: conv!.flow_step,
    awaiting_selection: conv!.flow_data?.awaiting_selection ?? false,
  });

  if (l1Match) {
    const reply = await handleCustomerBooking(externalId, tenantId, l1Match, conv!, message);
    if (reply) await sendReplyByChannel(providerConfig, tenantId, externalId, reply, channel);
    await markMessagesProcessed(allMessageIds);
    return;
  }

  if (looksLikeShowcaseRequest(message)) {
    const showcase = await sendShowcasePack(tenantId, externalId, undefined, message);
    if (showcase.success) {
      await markMessagesProcessed(allMessageIds);
      return;
    }
  }

  // L2
  const aiReply = await callAIWithRetry(tenantId, message, conv!, 'customer', messageId);
  if (!aiReply) {
    await sendReplyByChannel(
      providerConfig,
      tenantId,
      externalId,
      'Sorry, I didn\'t get that. Type *help* to see what I can do.',
      channel
    );
    return;
  }

  const reply = await handleCustomerBooking(externalId, tenantId, aiReply, conv!, message);
  if (reply) await sendReplyByChannel(providerConfig, tenantId, externalId, reply, channel);

  await markMessagesProcessed(allMessageIds);
}

// ─── AI call with retry + quota ───────────────────────────────────────────────

async function callAIWithRetry(
  tenantId: string,
  message: string,
  conv: NonNullable<Awaited<ReturnType<typeof getConversation>>>,
  userRole: 'owner' | 'customer',
  messageId: string
): Promise<AIResponse | null> {
  // Check quota — if exceeded, return null (caller uses button menu fallback)
  if (await isQuotaExceeded('lite')) {
    if (await isQuotaExceeded('flash')) return null;
    // Flash budget remaining — go straight to L3
    return callFlash(tenantId, message, conv, userRole, messageId);
  }

  // Try L2 first
  for (let attempt = 0; attempt < MAX_AI_RETRIES; attempt++) {
    try {
      const prompt = await buildPrompt(tenantId, message, conv, userRole, null);
      const result = await withTenantWalletSpend(
        supabaseAdmin,
        tenantId,
        {
          estimatedTokens: estimatePromptTokens(prompt.length),
          provider: V2_AI_PROVIDER === 'openrouter' ? 'openrouter' : (V2_AI_PROVIDER === 'google' ? 'google_ai' : 'auto'),
          model: FLASH_LITE_MODEL,
          requestId: `${messageId}:lite:${attempt}`,
          description: 'WhatsApp v2 L2 AI call',
          metadata: {
            flow: 'whatsapp_v2',
            stage: 'lite',
            user_role: userRole,
            message_id: messageId,
            attempt,
          },
        },
        () => callAIProviderWithFallback(
          [{ role: 'user', content: prompt }],
          FLASH_LITE_MODEL
        )
      );

      const parsed = parseAIResponse(result.json);
      if (!parsed) continue;

      // Validate the AI's proposed action
      const validation = await validateAction(tenantId, parsed);
      if (!validation.valid) {
        // Retry with error context
        if (attempt < MAX_AI_RETRIES - 1) {
          const retryPrompt = await buildPrompt(tenantId, message, conv, userRole, validation.retryContext ?? null);
          const retryResult = await callAIProviderWithFallback([{ role: 'user', content: retryPrompt }], FLASH_LITE_MODEL);
          const retryParsed = parseAIResponse(retryResult.json);
          if (retryParsed) {
            const retryValidation = await validateAction(tenantId, retryParsed);
            if (retryValidation.valid) {
              await recordUsage(result, messageId, 'lite');
              return retryParsed;
            }
          }
        }
        continue;
      }

      await recordUsage(result, messageId, 'lite');

      // Escalate low-confidence responses to L3
      if (parsed.confidence === 'low' || parsed.action === 'escalate') {
        return callFlash(tenantId, message, conv, userRole, messageId);
      }

      return parsed;
    } catch (err) {
      console.error('[pipeline] L2 call failed', err);
    }
  }

  // L2 failed — try L3
  return callFlash(tenantId, message, conv, userRole, messageId);
}

async function callFlash(
  tenantId: string,
  message: string,
  conv: NonNullable<Awaited<ReturnType<typeof getConversation>>>,
  userRole: 'owner' | 'customer',
  messageId: string
): Promise<AIResponse | null> {
  try {
    const prompt = await buildPrompt(tenantId, message, conv, userRole, null);
    const result = await withTenantWalletSpend(
      supabaseAdmin,
      tenantId,
      {
        estimatedTokens: estimatePromptTokens(prompt.length),
        provider: V2_AI_PROVIDER === 'openrouter' ? 'openrouter' : (V2_AI_PROVIDER === 'google' ? 'google_ai' : 'auto'),
        model: FLASH_MODEL,
        requestId: `${messageId}:flash`,
        description: 'WhatsApp v2 L3 AI call',
        metadata: {
          flow: 'whatsapp_v2',
          stage: 'flash',
          user_role: userRole,
          message_id: messageId,
        },
      },
      () => callAIProviderWithFallback([{ role: 'user', content: prompt }], FLASH_MODEL)
    );
    const parsed = parseAIResponse(result.json);
    if (parsed) await recordUsage(result, messageId, 'flash');
    return parsed;
  } catch (err) {
    console.error('[pipeline] L3 Flash call failed', err);
    return null;
  }
}

function isGoogleQuotaOrRateError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|quota|rate/i.test(msg);
}

function getOpenRouterModelChain(): string[] {
  const defaults = [
    OPENROUTER_V2_MODEL,
    process.env.OPENROUTER_FALLBACK_MODEL || '',
    'openai/gpt-4o-mini',
  ];

  return [...defaults, ...OPENROUTER_V2_FALLBACK_MODELS]
    .map((m) => m.trim())
    .filter(Boolean)
    .filter((m, idx, arr) => arr.indexOf(m) === idx);
}

async function callOpenRouterWithModelChain(
  messages: Array<{ role: string; content: string }>
): Promise<{ json: unknown; usage: unknown }> {
  const models = getOpenRouterModelChain();
  let lastErr: unknown = null;

  for (const model of models) {
    try {
      return await callOpenRouter(messages, model, 1);
    } catch (err) {
      lastErr = err;
      console.warn('[pipeline] OpenRouter model attempt failed', { model, error: err instanceof Error ? err.message : String(err) });
    }
  }

  throw lastErr ?? new Error('All OpenRouter model attempts failed');
}

async function callAIProviderWithFallback(
  messages: Array<{ role: string; content: string }>,
  googleModel: string
): Promise<{ json: unknown; usage: unknown }> {
  if (V2_AI_PROVIDER === 'openrouter' || V2_DISABLE_GOOGLE) {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error('WHATSAPP_V2_AI_PROVIDER=openrouter but OPENROUTER_API_KEY is not set');
    }
    return callOpenRouterWithModelChain(messages);
  }

  if (V2_AI_PROVIDER === 'google') {
    return callGoogleAI(messages, googleModel);
  }

  try {
    return await callGoogleAI(messages, googleModel);
  } catch (err) {
    // v2 historically used Gemini directly; when that quota/rate-limits,
    // fall back to OpenRouter so tenant messaging does not stall.
    if (!process.env.OPENROUTER_API_KEY) throw err;
    if (!isGoogleQuotaOrRateError(err)) throw err;
    return callOpenRouterWithModelChain(messages);
  }
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

async function buildPrompt(
  tenantId: string,
  message: string,
  conv: NonNullable<Awaited<ReturnType<typeof getConversation>>>,
  userRole: 'owner' | 'customer',
  retryContext: string | null
): Promise<string> {
  // Load tenant + settings
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('name, location, settings, buffer_minutes, timezone')
    .eq('id', tenantId)
    .single();

  const settings = tenant?.settings ?? {};
  const vertical = settings.vertical ?? 'general';
  const staffTitle = settings.staff_title ?? 'staff';
  const staffTitlePlural = settings.staff_title_plural ?? 'staff members';
  const bookingNoun = settings.booking_noun ?? 'booking';
  const sessionNoun = settings.session_noun ?? 'session';
  const personality = settings.ai_personality ?? 'friendly and professional';
  const customInstructions = settings.custom_ai_instructions ?? '';

  // Load services
  const { data: services } = await supabaseAdmin
    .from('services')
    .select('name, price_cents, duration_minutes')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('sort_order');

  const servicesList = (services ?? [])
    .map((s) => `${s.name} — ₦${Math.round((s.price_cents ?? 0) / 100).toLocaleString()} (${s.duration_minutes ?? 60}min)`)
    .join(', ');

  // Load staff
  const { data: staff } = await supabaseAdmin
    .from('tenant_users')
    .select('id, phone')
    .eq('tenant_id', tenantId)
    .in('role', ['staff', 'owner'])
    .eq('status', 'active');

  const staffList = (staff ?? []).map((s) => s.phone ?? s.id).join(', ');

  const ownerInstructions = userRole === 'owner' ? `
This ${staffTitle} owner manages ${tenant?.name ?? 'this business'} (${vertical} business).
They can ask you to: check schedules, block time, mark staff unavailable, cancel/reschedule ${bookingNoun}s,
add/edit services and prices, add staff, get daily summaries, and record walk-in customers.
When the owner asks for a change that affects customers, confirm before executing.
For walk-in requests (e.g. "walk-in Ada haircut"), use action "walk_in" with staff_name and service_name params — no confirmation needed.
Resolve staff names from the staff list above.` : '';

  const retryNote = retryContext ? `\nPrevious attempt failed: ${retryContext}\nPlease correct and try again.\n` : '';

  return `You are a booking assistant for ${tenant?.name ?? 'this business'}, a ${vertical} business${tenant?.location ? ` in ${tenant.location}` : ''}.

Business context:
- Services: ${servicesList || 'no services set up yet'}
- ${staffTitlePlural}: ${staffList || 'none yet'}
- Buffer between ${bookingNoun}s: ${tenant?.buffer_minutes ?? 15} minutes
- Timezone: ${tenant?.timezone ?? 'Africa/Lagos'}

Language rules:
- Refer to staff as "${staffTitle}" (plural: "${staffTitlePlural}")
- Call bookings a "${bookingNoun}"
- Call visits a "${sessionNoun}"
- Tone: ${personality}
${customInstructions}
${ownerInstructions}

Current context:
- Flow: ${conv.current_flow} / step ${conv.flow_step}
- Booking in progress: ${JSON.stringify(conv.flow_data?.booking_in_progress ?? null)}
${retryNote}
User message: "${message}"

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "action": "create_booking | get_availability | list_services | list_staff | get_price | cancel_booking | reschedule_booking | mark_no_show | add_service | update_service | add_staff | update_schedule | block_slot | walk_in | get_insights | owner_query | general_reply | needs_info | escalate",
  "params": {},
  "reply": "the message to send the user in natural language matching the business tone",
  "confidence": "high | medium | low"
}

Rules:
- Never invent services, prices, or staff not listed above
- If confidence is low or the situation is complex, use action "escalate"
- If you need more info, use action "needs_info" and ask clearly in "reply"
- For write actions (cancel, reschedule, update), confirm with the user first in "reply"
- If asked something outside scope, use "general_reply"`;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function parseAIResponse(raw: unknown): AIResponse | null {
  try {
    type OpenAIChoice = { message?: { content?: string } };
    type OpenAIResponse = { choices?: OpenAIChoice[] };
    const text = typeof raw === 'string'
      ? raw
      : ((raw as OpenAIResponse | null)?.choices?.[0]?.message?.content ?? '');

    if (!text) return null;

    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.action || !parsed.reply) return null;
    return parsed as AIResponse;
  } catch {
    return null;
  }
}

async function recordUsage(
  result: { usage: unknown },
  messageId: string,
  layer: 'lite' | 'flash'
): Promise<void> {
  const usage = result.usage as Record<string, number> | null;
  const tokens = (usage?.total_tokens ?? usage?.completion_tokens ?? 0) as number;
  await recordAIUsage(messageId, layer, tokens);
}

async function markMessagesProcessed(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  await supabaseAdmin
    .from('whatsapp_message_queue')
    .update({ status: 'completed', processed_at: new Date().toISOString() })
    .in('id', messageIds);
}

/**
 * Fetches the Instagram provider config for a tenant.
 * Reads from `whatsapp_provider_secrets` (channel='instagram') — same table used
 * for WhatsApp secrets.  Returns null if no IG config is stored yet.
 *
 * This is a stub for Phase 1 IG wiring: credential storage UI is a later phase.
 * The stub must compile and be unit-testable; calling it with no DB row returns null
 * and the send is skipped gracefully (logged, not thrown).
 */
export async function getTenantInstagramConfig(tenantId: string): Promise<ProviderConfig | null> {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_provider_secrets')
    .select('api_key, base_url, instance_name')
    .eq('tenant_id', tenantId)
    .eq('provider', 'instagram')
    .maybeSingle();

  if (error) {
    console.error('[pipeline] getTenantInstagramConfig error', error);
    return null;
  }
  if (!data?.api_key || !data?.base_url || !data?.instance_name) {
    return null;
  }

  return {
    provider: 'instagram',
    baseUrl: data.base_url as string,
    apiKey: data.api_key as string,
    instanceName: data.instance_name as string,
  };
}

/**
 * Resolves the correct provider config for the given channel.
 * WhatsApp: uses getTenantWhatsAppConfig (existing path, unchanged).
 * Instagram: uses getTenantInstagramConfig stub.
 * Returns null if no config is found — callers must handle null gracefully.
 */
async function resolveProviderConfig(
  tenantId: string,
  channel: ConvChannel
): Promise<{ config: EvolutionAPIConfig | ProviderConfig; client: ReturnType<typeof getProviderClient> } | null> {
  if (channel === 'instagram') {
    const igConfig = await getTenantInstagramConfig(tenantId);
    if (!igConfig) {
      console.warn(`[pipeline] No Instagram config for tenant ${tenantId} — outbound send will be skipped`);
      return null;
    }
    return { config: igConfig, client: getProviderClient(igConfig) };
  }

  // Default: WhatsApp path (unchanged behaviour)
  const waConfig = await getTenantWhatsAppConfig(tenantId);
  if (!waConfig) {
    throw new Error(`Missing WhatsApp configuration for tenant ${tenantId}`);
  }
  return { config: waConfig, client: getProviderClient(waConfig) };
}

/**
 * Sends a reply via the correct channel adapter and persists an outbound message row.
 * For Instagram: if no config is found, logs a warning and skips the send (no throw).
 * For WhatsApp: preserves the existing throw-on-failure behaviour.
 */
async function sendReplyByChannel(
  providerContext: { config: EvolutionAPIConfig | ProviderConfig; client: ReturnType<typeof getProviderClient> } | null,
  tenantId: string,
  externalId: string,
  reply: string,
  channel: ConvChannel
): Promise<void> {
  if (!providerContext) {
    // No config — skip outbound (already warned in resolveProviderConfig)
    return;
  }

  const { config, client } = providerContext;
  const sendResult = await client.sendTextMessage(externalId, reply);

  if (!sendResult.success) {
    if (channel === 'instagram') {
      // Instagram sends are best-effort for now — log and continue
      console.error(`[pipeline] Outbound Instagram send failed (tenant=${tenantId}, to=${externalId})`);
      return;
    }
    // WhatsApp: preserve original throw behaviour
    const waConfig = config as EvolutionAPIConfig;
    throw new Error(`Outbound WhatsApp send failed (provider=${waConfig.provider ?? 'evolution'}, tenant=${tenantId}, to=${externalId})`);
  }

  // Persist outbound message row (same for both channels)
  const { data: chat } = await supabaseAdmin
    .from('chats')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('customer_phone', externalId)
    .maybeSingle();

  const instanceName = (config as EvolutionAPIConfig).instanceName ?? (config as ProviderConfig).instanceName;

  await supabaseAdmin.from('messages').insert({
    tenant_id: tenantId,
    chat_id: chat?.id ?? null,
    from_number: instanceName,
    to_number: externalId,
    content: reply,
    direction: 'outbound',
    message_type: 'text',
    channel,
    evolution_message_id: sendResult.messageId ?? null,
    timestamp: new Date().toISOString(),
  });
}

/** @deprecated Use sendReplyByChannel instead. Kept for any external callers. */
async function sendReplyAndPersistOutbound(
  waConfig: EvolutionAPIConfig,
  client: ReturnType<typeof getProviderClient>,
  tenantId: string,
  phone: string,
  reply: string
): Promise<void> {
  await sendReplyByChannel({ config: waConfig, client }, tenantId, phone, reply, 'whatsapp');
}

async function isTenantActivated(tenantId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('tenants')
    .select('routing_code')
    .eq('id', tenantId)
    .maybeSingle();
  return !!data?.routing_code;
}
