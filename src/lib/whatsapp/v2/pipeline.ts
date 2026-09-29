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

import { createHash } from 'crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { normalizePidgin, matchRule } from '@/lib/ai/rulesEngine';
import { isQuotaExceeded, recordAIUsage } from '@/lib/ai/quotaTracker';
import { getConversation, ensureConversation, updateConversation } from './conversationState';
import type { ConvChannel } from './conversationState';
import { sendDisclosureIfNeeded } from './aiDisclosure';
import { wantsHuman, createHumanHandoff } from './humanHandoff';
import { isHumanHandling } from './humanTakeover';
import { buildOptInProofPatch } from './optInProof';
import type { ClaimedConversationBatch } from './queueBatch';
import { validateAction, type AIResponse } from '@/lib/booking/action-validator';
import { getTenantWhatsAppConfig, isTenantWhatsAppAgentEnabled } from '@/lib/whatsapp/evolutionClient';
import { getProviderClient } from '@/lib/whatsapp/providers';
import { getTenantWhatsAppProviderClientUnmetered } from '@/lib/whatsapp/providers/unmetered';
import type { EvolutionAPIConfig } from '@/lib/whatsapp/evolutionClient';
import type { ProviderConfig } from '@/lib/whatsapp/providers';
import { estimatePromptTokens, withTenantWalletSpend } from '@/lib/billing/ai-wallet';
import { looksLikeShowcaseRequest, sendShowcasePack } from '@/lib/whatsapp/showcasePackService';
import { handleOwnerCommand } from './flows/ownerCommands';
import { handleOnboarding, handleOwnerEmailUpdate } from './flows/ownerOnboarding';
import { handleCustomerBooking } from './flows/customerBooking';
import { detectOptOutKeyword, type OptOutSignal } from './optOut';
import { brandCustomerText } from './outboundBranding';
import type { ConvState } from './conversationState';
import { routeIntent } from '@/lib/ai/intent-router';
import { getGroundingData } from '@/lib/ai/grounding-service';
import { buildFrontDeskPrompt } from '@/lib/ai/context-builder';
import { getAIProvider } from '@/lib/ai/providers';
import { recordAITrainingEvent } from '@/lib/ai/training-events';
import { recordFrontDeskEvent } from '@/lib/ai/front-desk-events';
import { checkCaps } from '@/lib/billing/spendCaps/spendGuard';
import { maybeAlertCap } from '@/lib/billing/spendCaps/spendAlerts';
import { ANALYTICS_EVENTS } from '@/lib/analytics/events';
import { captureServerAnalyticsEvent } from '@/lib/analytics/server';
import { getInstagramSecret } from '@/lib/instagram/secrets';
import { consumeStorefrontContextMarker } from '@/lib/storefront/context';
import { sendOutboundOnce } from './outboundDelivery';
import { parseConversationStructuredState } from './structuredState';
import { parseProposedStatePatch, reduceConversationState } from './stateReducer';
import { updateThreadState } from './conversationThread';
import { assembleConversationContext } from '@/lib/ai/conversation-context';
import { maybeScheduleConversationSummary } from './conversationSummary';

const supabaseAdmin = createSupabaseAdminClient();

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
const CLOUDFLARE_V2_MODEL = process.env.CLOUDFLARE_AI_DEFAULT_MODEL || '@cf/meta/llama-3.1-8b-instruct';
const CLOUDFLARE_V2_FALLBACK_MODELS = (process.env.CLOUDFLARE_AI_FALLBACK_MODELS || '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const V2_AI_PROVIDER = (process.env.WHATSAPP_V2_AI_PROVIDER || 'auto').toLowerCase();
const V2_DISABLE_GOOGLE = process.env.WHATSAPP_V2_DISABLE_GOOGLE === 'true';

function walletProvider(): 'cloudflare' | 'openrouter' | 'google_ai' | 'auto' {
  if (V2_AI_PROVIDER === 'cloudflare') return 'cloudflare';
  if (V2_AI_PROVIDER === 'openrouter') return 'openrouter';
  if (V2_AI_PROVIDER === 'google') return 'google_ai';
  return 'auto';
}

function walletModel(googleModel: string): string {
  if (V2_AI_PROVIDER === 'cloudflare') return CLOUDFLARE_V2_MODEL;
  if (V2_AI_PROVIDER === 'openrouter') return OPENROUTER_V2_MODEL;
  return googleModel;
}

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
export interface BatchProcessResult {
  disposition: 'complete';
  correlationKey: string;
}

export interface ConversationExecutionContext {
  correlationKey: string;
  threadId: string;
}

export async function processConversationBatch(
  batch: ClaimedConversationBatch,
): Promise<BatchProcessResult> {
  const { externalId, tenantId, channel } = batch;
  const executionContext: ConversationExecutionContext = {
    correlationKey: batch.correlationKey,
    threadId: batch.threadId,
  };
  const messageId = batch.rows[batch.rows.length - 1]?.messageId;
  if (!messageId) throw new Error('Conversation batch has no message identity');
  const completed = async (): Promise<BatchProcessResult> => {
    await maybeScheduleConversationSummary({ tenantId, threadId: batch.threadId }).catch((error) => {
      console.warn('[pipeline] conversation summary scheduling skipped', {
        tenantId,
        reason: error instanceof Error ? error.message : 'unknown',
      });
    });
    return { disposition: 'complete', correlationKey: batch.correlationKey };
  };
  let rawMessage = batch.combinedText;

  // ── 2. Load conversation state ─────────────────────────────────────────────
  let conv = await getConversation(externalId, tenantId, channel);
  if (!conv) {
    conv = await ensureConversation(externalId, tenantId, 'unknown', channel);
  }
  const storefrontHandoff = consumeStorefrontContextMarker(rawMessage, tenantId);
  rawMessage = storefrontHandoff.message;
  if (storefrontHandoff.context) {
    const flow_data = { ...(conv.flow_data ?? {}), storefront_context: storefrontHandoff.context };
    await updateConversation(externalId, tenantId, { flow_data }, channel);
    conv.flow_data = flow_data;
  }
  const normalized = normalizePidgin(rawMessage);

  // The queue worker is the canonical inbound path. Enforce the same
  // tenant-level automation switch here as in the legacy processor so a
  // disabled agent never sends disclosures, AI replies, or booking actions.
  // Owner/staff commands remain available for operational recovery.
  if (
    channel === 'whatsapp' &&
    conv.role !== 'owner' &&
    conv.role !== 'staff' &&
    !await isTenantWhatsAppAgentEnabled(tenantId)
  ) {
    return completed();
  }

  // ── Opt-out keyword (customers only) ──────────────────────────────────────
  const optSignal: OptOutSignal = detectOptOutKeyword(rawMessage);
  if (optSignal && conv.role !== 'owner' && conv.role !== 'staff') {
    await handleOptOutSignal(externalId, tenantId, optSignal);
    return completed();
  }

  // ── Record inbound time AFTER capturing the prior value in `conv` ──────────
  // `conv.last_inbound_at` (loaded above) is the value branding uses THIS turn;
  // we update the DB to now() for the NEXT turn's session/drift checks.
  await supabaseAdmin
    .from('whatsapp_conversations')
    .update({ last_inbound_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('channel', channel)
    .eq('external_id', externalId);

  // ── 3. Route to appropriate flow handler ──────────────────────────────────
  // Owner onboarding is handled separately from the main pipeline
  if (conv.current_flow === 'onboarding' || (conv.role === 'owner' && conv.current_flow === 'idle' && !await isTenantActivated(tenantId))) {
    const onboardingReply = await handleOnboarding(externalId, tenantId, normalized, conv);
    // handleOnboarding's return value used to be discarded here, which made the
    // entire WhatsApp-native owner signup silent: every step computed its reply
    // and threw it away, so an owner saying "hi" got nothing back.
    if (onboardingReply) {
      const onboardingConfig = await resolveProviderConfig(tenantId, channel);
      await sendReplyByChannel(onboardingConfig, tenantId, externalId, onboardingReply, channel, { executionContext });
    }
    return completed();
  }

  if (conv.role === 'owner' || conv.role === 'staff') {
    await handleOwnerOrStaffMessage(externalId, tenantId, normalized, conv, messageId, channel, executionContext);
    return completed();
  }

  // Customer path
  await handleCustomerMessage(externalId, tenantId, normalized, conv, messageId, channel, executionContext);
  return completed();
}

// ─── Owner / staff message handler ───────────────────────────────────────────

async function handleOwnerOrStaffMessage(
  externalId: string,
  tenantId: string,
  message: string,
  conv: Awaited<ReturnType<typeof getConversation>> & object,
  messageId: string,
  channel: ConvChannel = 'whatsapp',
  executionContext?: ConversationExecutionContext,
): Promise<void> {
  const providerConfig = await resolveProviderConfig(tenantId, channel);

  // "my email is ..." — handled ahead of L1 and L2 because it is mechanical,
  // needs no model call, and is what the onboarding skip copy promises. It
  // routes the conversation back into the onboarding flow at the verification
  // step, so the code the owner types next lands in handleStep7.
  const emailUpdateReply = await handleOwnerEmailUpdate(externalId, tenantId, message, conv!);
  if (emailUpdateReply) {
    await sendReplyByChannel(providerConfig, tenantId, externalId, emailUpdateReply, channel, { executionContext });
    return;
  }

  // L1 check — yes/no/numbers for confirming AI-proposed actions
  const l1Match = matchRule(message, {
    current_flow: conv!.current_flow,
    flow_step: conv!.flow_step,
    awaiting_selection: conv!.flow_data?.awaiting_selection ?? false,
  });

  if (l1Match) {
    const reply = await handleOwnerCommand(externalId, tenantId, l1Match, conv!, message);
    if (reply) {
      await sendReplyByChannel(providerConfig, tenantId, externalId, reply, channel, { executionContext });
    }
    return;
  }

  // L2 for owner commands
  const aiReply = await callAIWithRetry(tenantId, message, conv!, 'owner', messageId, channel);
  if (!aiReply) {
    await sendReplyByChannel(
      providerConfig,
      tenantId,
      externalId,
      'Sorry, I had trouble understanding that. Try again or type *help* for options.',
      channel,
      { executionContext },
    );
    return;
  }

  const reply = await handleOwnerCommand(externalId, tenantId, aiReply, conv!, message);
  if (reply) {
    await sendReplyByChannel(providerConfig, tenantId, externalId, reply, channel, { executionContext });
  }

}

// ─── Customer message handler ─────────────────────────────────────────────────

async function handleCustomerMessage(
  externalId: string,
  tenantId: string,
  message: string,
  conv: Awaited<ReturnType<typeof getConversation>> & object,
  messageId: string,
  channel: ConvChannel = 'whatsapp',
  executionContext?: ConversationExecutionContext,
): Promise<void> {
  const analyticsState = (conv!.flow_data?.analytics ?? {}) as Record<string, unknown>;

  // Record customer-initiated opt-in proof once per conversation (flow_data).
  const optInPatch = buildOptInProofPatch(conv!.flow_data, channel);
  if (optInPatch) {
    const merged = { ...(conv!.flow_data ?? {}), ...optInPatch };
    await updateConversation(externalId, tenantId, { flow_data: merged }, channel);
    conv!.flow_data = merged;
  }

  // A human is handling this conversation from the dashboard, so store inbound
  // messages but do not let the AI send disclosures or replies.
  if (isHumanHandling(conv!.flow_data)) {
    return;
  }

  const providerConfig = await resolveProviderConfig(tenantId, channel);

  // First-contact AI disclosure (once per customer; flag persisted in flow_data).
  // Guarded by providerConfig so we never mark "sent" when no channel is configured.
  if (providerConfig) {
    await sendDisclosureIfNeeded({
      flowData: conv!.flow_data,
      send: (text) => sendReplyByChannel(providerConfig, tenantId, externalId, text, channel, { executionContext }),
      persist: async (patch) => {
        const merged = { ...(conv!.flow_data ?? {}), ...patch };
        await updateConversation(externalId, tenantId, { flow_data: merged }, channel);
        conv!.flow_data = merged;
      },
    });
  }

  // Explicit "reach a human" request → create an escalation ticket and stop.
  if (wantsHuman(message)) {
    await recordFrontDeskEvent({
      tenantId,
      eventType: 'handoff_requested',
      eventCategory: 'support',
      channel,
      actorRole: 'customer',
      messageId,
      correlationId: messageId,
      metadata: { reason: 'customer_requested_human' },
    });
    await captureServerAnalyticsEvent({
      event: ANALYTICS_EVENTS.HUMAN_HANDOFF_REQUESTED,
      properties: {
        tenant_id: tenantId,
        channel,
        flow: 'support',
        metadata: {
          current_flow: conv!.current_flow,
          reason: 'customer_requested_human',
        },
      },
      distinctId: externalId,
    });
    await createHumanHandoff(supabaseAdmin, {
      tenantId,
      customerPhone: externalId,
      sessionId: conv!.id,
      reason: 'customer requested human',
    });
    await sendReplyByChannel(
      providerConfig,
      tenantId,
      externalId,
      "Got it — I've passed this to a team member who'll get back to you shortly. 🙌",
      channel,
      { executionContext },
    );
    return;
  }

  await recordFrontDeskEvent({
    tenantId,
    eventType: 'inquiry_received',
    eventCategory: 'conversation',
    channel,
    actorRole: 'customer',
    messageId,
    correlationId: messageId,
    metadata: {
      current_flow: conv!.current_flow,
      awaiting_selection: conv!.flow_data?.awaiting_selection ?? false,
    },
  });

  if (!analyticsState.first_customer_message_recorded) {
    const mergedFlowData = {
      ...(conv!.flow_data ?? {}),
      analytics: {
        ...analyticsState,
        first_customer_message_recorded: true,
        first_customer_message_at: new Date().toISOString(),
      },
    };
    await updateConversation(externalId, tenantId, { flow_data: mergedFlowData }, channel);
    conv!.flow_data = mergedFlowData;

    await captureServerAnalyticsEvent({
      event: ANALYTICS_EVENTS.FIRST_CUSTOMER_MESSAGE_RECEIVED,
      properties: {
        tenant_id: tenantId,
        channel,
        flow: 'activation',
        provider: channel === 'instagram' ? 'meta' : 'system',
        metadata: {
          current_flow: conv!.current_flow,
          conversation_id: conv!.id,
        },
      },
      distinctId: externalId,
    });
  }

  // L1 check
  const l1Match = matchRule(message, {
    current_flow: conv!.current_flow,
    flow_step: conv!.flow_step,
    awaiting_selection: conv!.flow_data?.awaiting_selection ?? false,
  });

  if (l1Match) {
    const reply = await handleCustomerBooking(externalId, tenantId, l1Match, conv!, message, executionContext);
    if (reply) await sendReplyByChannel(providerConfig, tenantId, externalId, reply, channel, { brand: true, conv, executionContext });
    return;
  }

  if (looksLikeShowcaseRequest(message)) {
    const showcase = await sendShowcasePack(tenantId, externalId, undefined, message);
    if (showcase.success) {
      return;
    }
  }

  // L2
  const aiReply = await callAIWithRetry(tenantId, message, conv!, 'customer', messageId, channel);
  if (!aiReply) {
    await sendReplyByChannel(
      providerConfig,
      tenantId,
      externalId,
      'Sorry, I didn\'t get that. Type *help* to see what I can do.',
      channel,
      { brand: true, conv, executionContext }
    );
    return;
  }

  if (aiReply.state_patch) {
    const previous = parseConversationStructuredState(conv!.flow_data?.structured_state);
    const reduced = reduceConversationState({
      previous,
      extracted: aiReply.state_patch,
      sourceMessageId: messageId,
      observedAt: new Date().toISOString(),
    });
    if (!executionContext?.threadId) throw new Error('Structured state update is missing its thread context');
    const updated = await updateThreadState({
      tenantId,
      threadId: executionContext.threadId,
      expectedVersion: conv!.state_version,
      state: reduced,
    });
    conv!.state_version = updated.stateVersion;
    conv!.flow_data = { ...conv!.flow_data, structured_state: reduced };
  }

  const reply = await handleCustomerBooking(externalId, tenantId, aiReply, conv!, message, executionContext);
  if (reply) await sendReplyByChannel(providerConfig, tenantId, externalId, reply, channel, { brand: true, conv, executionContext });

}

// ─── Opt-out handler ──────────────────────────────────────────────────────────

async function handleOptOutSignal(
  phone: string,
  tenantId: string,
  signal: OptOutSignal
): Promise<void> {
  // COMPLIANCE: opt-out confirmations go through the UNMETERED client.
  // getProviderClient meters any config carrying a tenantId, and a refused
  // reservation makes withMetering send the wallet-exhausted handoff instead —
  // so a customer who texted STOP would be told "a member of our team will
  // reply to you here shortly", the opposite of what they asked for, and that
  // handoff would itself be an unsolicited message to someone who just
  // unsubscribed. These are regulatory messages, not commercial ones: Booka
  // funds them, and they must send whatever the tenant's balance is.
  const client = await getTenantWhatsAppProviderClientUnmetered(tenantId);
  if (!client) return;

  if (signal === 'stop') {
    await supabaseAdmin
      .from('whatsapp_conversations')
      .update({ opted_out_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('phone_number', phone);
    await client.sendTextMessage(phone, "You're unsubscribed from reminders. Reply START to resume.");
  } else if (signal === 'start') {
    await supabaseAdmin
      .from('whatsapp_conversations')
      .update({ opted_out_at: null })
      .eq('tenant_id', tenantId)
      .eq('phone_number', phone);
    await client.sendTextMessage(phone, "You're resubscribed. 👍");
  }
}

// ─── AI call with retry + quota ───────────────────────────────────────────────

async function callAIWithRetry(
  tenantId: string,
  message: string,
  conv: NonNullable<Awaited<ReturnType<typeof getConversation>>>,
  userRole: 'owner' | 'customer',
  messageId: string,
  channel: ConvChannel = 'whatsapp'
): Promise<AIResponse | null> {
  const cap = await checkCaps(supabaseAdmin, tenantId);
  if (!cap.allowed) {
    if (cap.reason !== 'ok') {
      await maybeAlertCap(supabaseAdmin, tenantId, cap.reason);
    }
    return null;
  }
  if (cap.softWarn) {
    await maybeAlertCap(supabaseAdmin, tenantId, 'soft_warn');
  }

  // Check quota — if exceeded, return null (caller uses button menu fallback)
  if (await isQuotaExceeded('lite')) {
    if (await isQuotaExceeded('flash')) return null;
    // Flash budget remaining — go straight to L3
    return callFlash(tenantId, message, conv, userRole, messageId, channel);
  }

  // Try L2 first
  for (let attempt = 0; attempt < MAX_AI_RETRIES; attempt++) {
    try {
      const promptContext = await buildPromptContext(tenantId, message, conv, userRole, null);
      const prompt = promptContext.prompt;
      const result = await withTenantWalletSpend(
        supabaseAdmin,
        tenantId,
        {
          estimatedTokens: estimatePromptTokens(prompt.length),
          provider: walletProvider(),
          model: walletModel(FLASH_LITE_MODEL),
          requestId: `${messageId}:lite:${attempt}`,
          description: 'WhatsApp v2 L2 AI call',
          metadata: {
            flow: 'whatsapp_v2',
            stage: 'lite',
            user_role: userRole,
            message_id: messageId,
            attempt,
          },
          skipCapCheck: true,
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
        await recordAITrainingEvent({
          tenantId,
          messageId,
          channel,
          userRole,
          message,
          intent: promptContext.route.intent,
          groundedContext: promptContext.grounding,
          llmResponse: parsed,
          backendAction: parsed.action,
          success: false,
          correction: validation.retryContext ?? validation.error ?? null,
        });
        // Retry with error context
        if (attempt < MAX_AI_RETRIES - 1) {
          const retryPromptContext = await buildPromptContext(tenantId, message, conv, userRole, validation.retryContext ?? null);
          const retryPrompt = retryPromptContext.prompt;
          const retryResult = await callAIProviderWithFallback([{ role: 'user', content: retryPrompt }], FLASH_LITE_MODEL);
          const retryParsed = parseAIResponse(retryResult.json);
          if (retryParsed) {
            const retryValidation = await validateAction(tenantId, retryParsed);
            if (retryValidation.valid) {
              await recordAITrainingEvent({
                tenantId,
                messageId,
                channel,
                userRole,
                message,
                intent: retryPromptContext.route.intent,
                groundedContext: retryPromptContext.grounding,
                llmResponse: retryParsed,
                backendAction: retryParsed.action,
                success: true,
                correction: validation.retryContext ?? null,
              });
              await recordUsage(result, messageId, 'lite');
              return retryParsed;
            }
          }
        }
        continue;
      }

      await recordAITrainingEvent({
        tenantId,
        messageId,
        channel,
        userRole,
        message,
        intent: promptContext.route.intent,
        groundedContext: promptContext.grounding,
        llmResponse: parsed,
        backendAction: parsed.action,
        success: true,
        correction: null,
      });
      await recordUsage(result, messageId, 'lite');

      // Escalate low-confidence responses to L3
      if (parsed.confidence === 'low' || parsed.action === 'escalate') {
        return callFlash(tenantId, message, conv, userRole, messageId, channel);
      }

      return parsed;
    } catch (err) {
      console.error('[pipeline] L2 call failed', err);
    }
  }

  // L2 failed — try L3
  return callFlash(tenantId, message, conv, userRole, messageId, channel);
}

async function callFlash(
  tenantId: string,
  message: string,
  conv: NonNullable<Awaited<ReturnType<typeof getConversation>>>,
  userRole: 'owner' | 'customer',
  messageId: string,
  channel: ConvChannel = 'whatsapp'
): Promise<AIResponse | null> {
  try {
    const promptContext = await buildPromptContext(tenantId, message, conv, userRole, null);
    const prompt = promptContext.prompt;
    const result = await withTenantWalletSpend(
      supabaseAdmin,
      tenantId,
      {
        estimatedTokens: estimatePromptTokens(prompt.length),
        provider: walletProvider(),
        model: walletModel(FLASH_MODEL),
        requestId: `${messageId}:flash`,
        description: 'WhatsApp v2 L3 AI call',
        metadata: {
          flow: 'whatsapp_v2',
          stage: 'flash',
          user_role: userRole,
          message_id: messageId,
        },
        skipCapCheck: true,
      },
      () => callAIProviderWithFallback([{ role: 'user', content: prompt }], FLASH_MODEL)
    );
    const parsed = parseAIResponse(result.json);
    if (!parsed) return null;

    const validation = await validateAction(tenantId, parsed);
    await recordAITrainingEvent({
      tenantId,
      messageId,
      channel,
      userRole,
      message,
      intent: promptContext.route.intent,
      groundedContext: promptContext.grounding,
      llmResponse: parsed,
      backendAction: parsed.action,
      success: validation.valid,
      correction: validation.retryContext ?? validation.error ?? null,
    });

    if (!validation.valid) return null;

    await recordUsage(result, messageId, 'flash');
    return parsed;
  } catch (err) {
    console.error('[pipeline] L3 Flash call failed', err);
    return null;
  }
}

async function callAIProviderWithFallback(
  messages: Array<{ role: string; content: string }>,
  googleModel: string
): Promise<{ json: unknown; usage: unknown }> {
  return getAIProvider({
    mode: V2_AI_PROVIDER,
    openRouterModel: OPENROUTER_V2_MODEL,
    openRouterFallbackModels: [
      process.env.OPENROUTER_FALLBACK_MODEL || '',
      'openai/gpt-4o-mini',
      ...OPENROUTER_V2_FALLBACK_MODELS,
    ],
    cloudflareModel: CLOUDFLARE_V2_MODEL,
    cloudflareFallbackModels: CLOUDFLARE_V2_FALLBACK_MODELS,
    disableGoogle: V2_DISABLE_GOOGLE,
  }).complete({
    messages: messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    model: googleModel,
  });
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

async function buildPromptContext(
  tenantId: string,
  message: string,
  conv: NonNullable<Awaited<ReturnType<typeof getConversation>>>,
  userRole: 'owner' | 'customer',
  retryContext: string | null
): Promise<{
  route: Awaited<ReturnType<typeof routeIntent>>;
  grounding: Awaited<ReturnType<typeof getGroundingData>>;
  prompt: string;
}> {
  const route = await routeIntent(message, {
    tenantId,
    userRole,
  });
  const grounding = await getGroundingData(tenantId, message, conv, route);
  const conversationContext = conv.active_thread_id && conv.customer_id
    ? await assembleConversationContext({
        tenantId,
        threadId: conv.active_thread_id,
        customerId: conv.customer_id,
      })
    : null;

  return {
    route,
    grounding,
    prompt: buildFrontDeskPrompt({
      grounding,
      message,
      conv,
      userRole,
      retryContext,
      conversationContext,
    }),
  };
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
    if (parsed.state_patch !== undefined) {
      parsed.state_patch = parseProposedStatePatch(parsed.state_patch);
    }
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
  const secret = await getInstagramSecret(supabaseAdmin, tenantId);
  if (!secret) return null;

  return {
    provider: 'instagram',
    baseUrl: process.env.INSTAGRAM_GRAPH_BASE_URL || 'https://graph.instagram.com/v25.0',
    apiKey: secret.accessToken,
    instanceName: secret.igId,
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
  channel: ConvChannel,
  opts?: {
    brand?: boolean;
    initiated?: boolean;
    conv?: ConvState | null;
    executionContext?: ConversationExecutionContext;
  }
): Promise<void> {
  if (!providerContext) {
    // No config — skip outbound (already warned in resolveProviderConfig)
    return;
  }

  const { config, client } = providerContext;

  // Brand-identity layer applies to WhatsApp only — brandCustomerText resolves
  // the conversation via whatsapp_conversations keyed by phone number.
  let finalText = reply;
  if (opts?.brand && channel === 'whatsapp') {
    const branded = await brandCustomerText(tenantId, externalId, reply, {
      initiated: opts.initiated ?? false,
      conv: opts.conv
        ? { last_inbound_at: opts.conv.last_inbound_at, opted_out_at: opts.conv.opted_out_at }
        : undefined,
    });
    if (branded === null) return; // opted-out initiated send → skip silently
    finalText = branded;
  }

  if (!opts?.executionContext) {
    throw new Error('Outbound conversation reply is missing its execution context');
  }

  const { data: chat } = await supabaseAdmin
    .from('chats')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('customer_phone', externalId)
    .maybeSingle();

  const instanceName = (config as EvolutionAPIConfig).instanceName ?? (config as ProviderConfig).instanceName;
  const digest = createHash('sha256')
    .update(`${channel}\u0000${externalId}\u0000${finalText}`)
    .digest('hex');
  const sendResult = await sendOutboundOnce({
    tenantId,
    threadId: opts.executionContext.threadId,
    idempotencyKey: `${opts.executionContext.correlationKey}:outbound:${digest}`,
    channel,
    chatId: chat?.id ?? null,
    from: instanceName,
    to: externalId,
    content: finalText,
    send: () => client.sendTextMessage(externalId, finalText),
  });

  if (sendResult.status === 'delivery_unknown') {
    console.warn('[pipeline] outbound delivery is unknown; automatic resend suppressed', {
      tenantId,
      channel,
      replayed: sendResult.replayed,
    });
    return;
  }

  if (sendResult.reason === 'wallet_exhausted') {
    console.warn('[pipeline] message wallet exhausted; alternate handoff completed', {
      tenantId,
      channel,
    });
    return;
  }

  if (sendResult.status === 'failed') {
    if (channel === 'instagram') {
      // Instagram sends are best-effort for now — log and continue
      console.error(`[pipeline] Outbound Instagram send failed (tenant=${tenantId}, to=${externalId})`);
      return;
    }
    // WhatsApp: preserve original throw behaviour
    const waConfig = config as EvolutionAPIConfig;
    throw new Error(`Outbound WhatsApp send failed (provider=${waConfig.provider ?? 'evolution'}, tenant=${tenantId}, to=${externalId})`);
  }

}

async function isTenantActivated(tenantId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('tenants')
    .select('routing_code')
    .eq('id', tenantId)
    .maybeSingle();
  return !!data?.routing_code;
}
