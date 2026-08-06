/**
 * Customer Booking Flow
 *
 * LLM-driven booking state machine for customers interacting via WhatsApp.
 *
 * Flow state is accumulated in whatsapp_conversations.flow_data:
 *   booking_in_progress: { service_id, staff_id, date, start_time, slot_lock_id }
 *
 * The AI receives the current booking_in_progress on every turn and
 * determines what information is still missing (needs_info) or whether
 * enough is known to confirm (create_booking).
 */

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import PaymentService from '@/lib/paymentService';
import { recordFrontDeskEvent } from '@/lib/ai/front-desk-events';
import { siasOperations } from '@/lib/sias-operations';
import { executeAction, type AIResponse } from '@/lib/booking/action-validator';
import { createReservation } from '@/lib/reservationService';
import { updateConversation, resetConversation, ConvState, ConvChannel } from '../conversationState';
import { getAvailableSlots, lockSlot, releaseLock } from '../slotEngine';
import { addToWaitlist } from '../waitlist';
import { defaultLogger } from '@/lib/logger';
import type { RuleMatch } from '@/lib/ai/rulesEngine';
import { updateChatJourneyByExternalId } from '@/lib/chats/journey-service';
import { addProductsToRetailCart } from '@/lib/commerce/retail-orders';
import { ANALYTICS_EVENTS } from '@/lib/analytics/events';
import { captureServerAnalyticsEvent } from '@/lib/analytics/server';
import { captureBookaException } from '@/lib/observability/sentry';
import { findCustomerByPhone, resolveCustomer } from '@/lib/customers/identity';

const supabaseAdmin = createSupabaseAdminClient();

function getTenantSettings(row: { metadata?: unknown; tone_config?: unknown } | null): Record<string, unknown> {
  return {
    ...((row?.metadata as Record<string, unknown> | null) ?? {}),
    tone_config: row?.tone_config ?? null,
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function handleCustomerBooking(
  phone: string,
  tenantId: string,
  input: RuleMatch | AIResponse,
  conv: ConvState,
  _rawMessage: string
): Promise<string> {
  void _rawMessage;

  // Resolve the channel-aware conversation key from the conv object.
  // This ensures updateConversation/resetConversation target the correct row
  // regardless of whether the message arrived via WhatsApp or Instagram.
  const convChannel: ConvChannel = conv.channel ?? 'whatsapp';
  const convExternalId: string = conv.external_id ?? phone;

  // ── L1 match ──────────────────────────────────────────────────────────────
  if (!('reply' in input)) {
    return handleCustomerRuleMatch(convExternalId, tenantId, input as RuleMatch, conv, convChannel);
  }

  // ── AI response ───────────────────────────────────────────────────────────
  const aiResp = input as AIResponse;

  switch (aiResp.action) {
    case 'get_availability':
      return handleGetAvailability(convExternalId, tenantId, aiResp, conv, convChannel);

    case 'create_booking':
      return handleCreateBooking(convExternalId, tenantId, aiResp, conv, convChannel);

    case 'cancel_booking':
      return handleCancelBooking(convExternalId, tenantId, aiResp, convChannel);

    case 'show_catalog':
      return handleShowCatalog(convExternalId, tenantId, aiResp);

    case 'send_quote':
      return handleSendQuote(convExternalId, tenantId, aiResp, conv, convChannel);

    case 'qualify_lead':
      return handleQualifyLead(convExternalId, tenantId, aiResp, conv, convChannel);

    case 'show_showcase':
      return handleShowShowcase(convExternalId, tenantId, aiResp);

    case 'recommend_products':
      return handleRecommendProducts(convExternalId, tenantId, aiResp);

    case 'offer_upsell':
      return handleOfferProducts(convExternalId, tenantId, aiResp, 'upsell', conv, convChannel);

    case 'offer_cross_sell':
      return handleOfferProducts(convExternalId, tenantId, aiResp, 'cross-sell', conv, convChannel);

    case 'create_retail_payment_link':
      return handleCreateRetailPaymentLink(convExternalId, tenantId, aiResp, conv, convChannel);

    case 'recover_lead':
      return handleRecoverLead(convExternalId, tenantId, aiResp, conv, convChannel);

    case 'general_reply':
    case 'needs_info':
    case 'list_services':
    case 'list_staff':
    case 'get_price':
    default:
      // Update flow state if AI advanced the booking_in_progress
      if (aiResp.params?.booking_update) {
        await updateConversation(convExternalId, tenantId, {
          current_flow: 'booking',
          flow_data: {
            ...conv.flow_data,
            booking_in_progress: {
              ...conv.flow_data?.booking_in_progress,
              ...aiResp.params.booking_update,
            },
            awaiting_selection: aiResp.action === 'list_services' || aiResp.action === 'list_staff',
          },
        }, convChannel);
      }
      return aiResp.reply;
  }
}

// ─── L1 rule handler ──────────────────────────────────────────────────────────

async function handleCustomerRuleMatch(
  externalId: string,
  tenantId: string,
  rule: RuleMatch,
  conv: ConvState,
  channel: ConvChannel = 'whatsapp'
): Promise<string> {
  switch (rule.action) {
    case 'greet':
      return getCustomerGreeting(tenantId, externalId);

    case 'help':
      return getCustomerHelp(tenantId);

    case 'affirm': {
      // Confirm a pending booking (takes priority over an upsell offer)
      if (conv.flow_data?.pending_confirmation) {
        return confirmBooking(externalId, tenantId, conv, channel);
      }
      // Accept a pending product upsell/cross-sell → record the conversion
      if (conv.flow_data?.pending_upsell) {
        return recordUpsellConversion(externalId, tenantId, conv, channel);
      }
      return 'What would you like to book today?';
    }

    case 'negate': {
      // Cancel the current booking flow
      const lockId = conv.flow_data?.booking_in_progress?.slot_lock_id;
      if (lockId) await releaseLock(lockId);
      await resetConversation(externalId, tenantId, channel);
      return 'No problem! Let me know if you\'d like to book another time.';
    }

    case 'select_option': {
      const options = conv.flow_data?.option_list as Array<{ id: string; name: string }> | undefined;
      const idx = (rule.params?.optionIndex ?? 1) - 1;
      if (options && options[idx]) {
        const selected = options[idx];
        // Store selection in booking_in_progress and prompt for next needed info
        await updateConversation(externalId, tenantId, {
          current_flow: 'booking',
          flow_data: {
            ...conv.flow_data,
            booking_in_progress: {
              ...conv.flow_data?.booking_in_progress,
              selected_id: selected.id,
              selected_name: selected.name,
            },
            awaiting_selection: false,
          },
        }, channel);
        return `Great choice — *${selected.name}*. When would you like to come in?`;
      }
      return 'Please choose one of the options listed.';
    }

    default:
      return 'What would you like to do?';
  }
}

// ─── Availability handler ─────────────────────────────────────────────────────

async function handleGetAvailability(
  externalId: string,
  tenantId: string,
  aiResp: AIResponse,
  conv: ConvState,
  channel: ConvChannel = 'whatsapp'
): Promise<string> {
  // This action payload has passed the action validator before reaching the
  // booking flow; keep the untyped boundary local to the AI integration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { service_id, tenant_staff_id, date } = aiResp.params as Record<string, any>;

  if (!service_id || !date) return aiResp.reply;

  const slots = await getAvailableSlots(tenantId, tenant_staff_id, date, service_id);
  const available = slots.filter((s) => s.available);
  const analyticsState = (conv.flow_data?.analytics ?? {}) as Record<string, unknown>;

  if (!available.length) {
    // Offer waitlist
    if (service_id && date) {
      await addToWaitlist(externalId, tenantId, { service_id, date, staff_id: tenant_staff_id });
    }
    const dateFormatted = new Date(date).toLocaleDateString('en-NG', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
    return `Unfortunately there are no available slots on ${dateFormatted}. I've added you to the waitlist — I'll let you know if a slot opens up!\n\nWould you like to try a different date?`;
  }

  // Present slots as numbered list
  const slotLines = available.slice(0, 8).map((s, i) => `  ${i + 1}. ${formatTime(s.start)}`);
  const optionList = available.slice(0, 8).map((s) => ({ id: `${date}T${s.start}`, name: s.start }));

  await updateConversation(externalId, tenantId, {
    current_flow: 'booking',
    flow_data: {
      ...conv.flow_data,
      analytics: {
        ...analyticsState,
        booking_flow_started_at: analyticsState.booking_flow_started_at ?? new Date().toISOString(),
        booking_flow_started_recorded: true,
      },
      booking_in_progress: {
        ...conv.flow_data?.booking_in_progress,
        service_id,
        tenant_staff_id,
        date,
      },
      option_list: optionList,
      awaiting_selection: true,
    },
  }, channel);
  await updateChatJourneyByExternalId({
    tenantId,
    externalId,
    patch: {
      type: 'booking',
      stage: 'selecting_slot',
    },
  }).catch(() => undefined);

  if (!analyticsState.booking_flow_started_recorded) {
    await captureServerAnalyticsEvent({
      event: ANALYTICS_EVENTS.BOOKING_FLOW_STARTED,
      properties: {
        tenant_id: tenantId,
        channel,
        flow: 'booking',
        service_id,
        staff_id: tenant_staff_id ?? null,
        metadata: {
          date,
        },
      },
      distinctId: externalId,
    });
  }

  await captureServerAnalyticsEvent({
    event: ANALYTICS_EVENTS.SLOT_PRESENTED,
    properties: {
      tenant_id: tenantId,
      channel,
      flow: 'booking',
      service_id,
      staff_id: tenant_staff_id ?? null,
      metadata: {
        date,
        available_slot_count: available.length,
      },
    },
    distinctId: externalId,
  });

  const dateFormatted = new Date(date).toLocaleDateString('en-NG', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return `Available slots on ${dateFormatted}:\n${slotLines.join('\n')}\n\nReply with the number of your preferred time.`;
}

// ─── Create booking handler ───────────────────────────────────────────────────

async function handleCreateBooking(
  externalId: string,
  tenantId: string,
  aiResp: AIResponse,
  conv: ConvState,
  channel: ConvChannel = 'whatsapp'
): Promise<string> {
  // Alias for clarity — the externalId is used as phone for WA, IGSID for IG
  const phone = externalId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { service_id, tenant_staff_id, date, start_time, end_time, customer_name } = aiResp.params as Record<string, any>;

  if (!service_id || !date || !start_time) return aiResp.reply;

  // Lock the slot
  const lockId = await lockSlot(tenantId, tenant_staff_id, date, start_time, end_time ?? start_time, phone);

  // Get service + staff details for confirmation message
  const [{ data: service }, { data: staff }] = await Promise.all([
    supabaseAdmin.from('services').select('name, price').eq('id', service_id).maybeSingle(),
    tenant_staff_id
      ? supabaseAdmin.from('tenant_users').select('phone').eq('id', tenant_staff_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const { data: tenantData } = await supabaseAdmin
    .from('tenants')
    .select('metadata, tone_config, name')
    .eq('id', tenantId)
    .maybeSingle();

  const tenantSettings: Record<string, unknown> = {
    ...((tenantData?.metadata as Record<string, unknown> | null) ?? {}),
    tone_config: tenantData?.tone_config ?? null,
  };
  const bookingNoun = String(tenantSettings.booking_noun ?? 'appointment');
  const servicePrice = Number(service?.price ?? 0);
  const price = service ? `₦${Math.round(servicePrice).toLocaleString()}` : '';
  const depositConfig = getDepositConfig(tenantSettings);
  const customerRow = await findCustomerByPhone(supabaseAdmin, tenantId, phone, 'id, merged_into');

  const { data: customerProfile } = customerRow?.id
    ? await supabaseAdmin
        .from('customer_profile_summary')
        .select('risk_score')
        .eq('tenant_id', tenantId)
        .eq('customer_id', customerRow.id)
        .maybeSingle()
    : { data: null };

  const riskScore = ((customerProfile?.risk_score as string | undefined) ?? 'low') as 'low' | 'medium' | 'high';
  const requiresDeposit = riskScore === 'high' || Boolean(depositConfig?.enabled);
  const depositAmountCents =
    requiresDeposit
      ? (depositConfig?.amount_cents && depositConfig.amount_cents > 0
          ? depositConfig.amount_cents
          : Math.max(Math.round(servicePrice * 100), 2500))
      : 0;
  const dateFormatted = new Date(date).toLocaleDateString('en-NG', {
    weekday: 'short', day: 'numeric', month: 'long',
  });
  const staffRecord = staff as { phone?: string; data?: { phone?: string } } | null;
  const staffLabel = staffRecord?.phone ?? staffRecord?.data?.phone ?? 'our team';
  const timeFormatted = formatTime(start_time);

  if (riskScore === 'high') {
    defaultLogger.warn('[customerBooking] high-risk customer requires deposit', {
      tenantId,
      phone,
      customerPhone: phone,
      bookingNoun,
    });
  } else if (riskScore === 'medium') {
    defaultLogger.warn('[customerBooking] medium-risk customer booking', {
      tenantId,
      phone,
      customerPhone: phone,
    });
  }

  // Store pending confirmation
  await updateConversation(externalId, tenantId, {
    current_flow: 'booking',
    flow_step: 4,
    flow_data: {
      ...conv.flow_data,
      booking_in_progress: {
        ...conv.flow_data?.booking_in_progress,
        service_id,
        tenant_staff_id,
        date,
        start_time,
        end_time,
        slot_lock_id: lockId,
      },
      pending_confirmation: {
        service_id,
        tenant_staff_id,
        date,
        start_time,
        end_time,
        customer_name,
        lock_id: lockId,
        ai_resp: aiResp,
        deposit_required: requiresDeposit,
        deposit_amount_cents: depositAmountCents,
      },
      awaiting_confirmation: true,
    },
  }, channel);
  await updateChatJourneyByExternalId({
    tenantId,
    externalId,
    patch: {
      type: 'booking',
      stage: 'awaiting_confirmation',
    },
  }).catch(() => undefined);

  const depositNote = riskScore === 'high'
    ? '\n\n*A deposit is required for this booking.*'
    : requiresDeposit
      ? `\n\n*A ${Math.round(depositAmountCents / 100).toLocaleString()} deposit will be required to secure this booking.*`
      : '';

  return `Please confirm your ${bookingNoun}:\n\n*${service?.name ?? 'Service'}* with ${staffLabel}\n${dateFormatted} at ${timeFormatted}${price ? `\n${price}` : ''}${depositNote}\n\nReply *YES* to confirm or *NO* to cancel.`;
}

// ─── Confirm booking ──────────────────────────────────────────────────────────

async function confirmBooking(
  externalId: string,
  tenantId: string,
  conv: ConvState,
  channel: ConvChannel = 'whatsapp'
): Promise<string> {
  // For WA, phone === externalId; for IG, externalId is the IGSID.
  // The customer record always uses the phone field for WA. For IG,
  // we store the IGSID in the phone field as a fallback identifier.
  const phone = externalId;
  const pending = conv.flow_data?.pending_confirmation;
  if (!pending) return 'No booking to confirm. What would you like to book?';

  const { service_id, tenant_staff_id, date, start_time, end_time, customer_name, lock_id } = pending;
  const bookingStartedAt = typeof conv.flow_data?.analytics?.booking_flow_started_at === 'string'
    ? conv.flow_data.analytics.booking_flow_started_at
    : null;
  const requiresDeposit = Boolean(pending.deposit_required);
  const depositAmountCents = Number(pending.deposit_amount_cents ?? 0);
  const { data: serviceRow } = await supabaseAdmin
    .from('services')
    .select('price')
    .eq('id', service_id)
    .maybeSingle();

  // Upsert customer record
  const customerId = await resolveCustomer(supabaseAdmin, tenantId, phone, {
    name: customer_name ?? phone,
    source: 'whatsapp_customer_booking',
  });
  const { data: customer } = customerId
    ? await supabaseAdmin
        .from('customers')
        .select('id, total_bookings, email')
        .eq('tenant_id', tenantId)
        .eq('id', customerId)
        .maybeSingle()
    : { data: null };

  // Create reservation
  const startAt = `${date}T${start_time}:00`;
  const endAt = end_time ? `${date}T${end_time}:00` : startAt;
  const reservationStatus = requiresDeposit ? 'deposit_pending' : 'confirmed';

  let reservation: { id: string } | null = null;
  try {
    reservation = await createReservation(supabaseAdmin as never, {
      tenant_id: tenantId,
      customer_id: customer?.id ?? null,
      customer_name: customer_name ?? phone,
      phone,
      service_id,
      service: service_id,
      start_at: startAt,
      end_at: endAt,
      status: reservationStatus,
      metadata: {
        source: 'whatsapp_v2_confirm',
        lock_id: lock_id ?? null,
      },
      staff_id: tenant_staff_id,
    }) as { id: string } | null;
  } catch (error) {
    console.error('[customerBooking] confirmBooking error', error);
    captureBookaException(error, {
      tenantId,
      channel,
      flow: 'booking',
      extra: {
        service_id,
        staff_id: tenant_staff_id,
      },
    });
    await captureServerAnalyticsEvent({
      event: ANALYTICS_EVENTS.BOOKING_FAILED,
      properties: {
        tenant_id: tenantId,
        channel,
        flow: 'booking',
        service_id,
        staff_id: tenant_staff_id ?? null,
        failure_reason: error instanceof Error ? error.message : 'reservation_creation_failed',
      },
      distinctId: externalId,
    });
    return 'Sorry, something went wrong confirming your booking. Please try again.';
  }

  if (!reservation) {
    await captureServerAnalyticsEvent({
      event: ANALYTICS_EVENTS.BOOKING_FAILED,
      properties: {
        tenant_id: tenantId,
        channel,
        flow: 'booking',
        service_id,
        staff_id: tenant_staff_id ?? null,
        failure_reason: 'reservation_not_created',
      },
      distinctId: externalId,
    });
    return 'Sorry, something went wrong confirming your booking. Please try again.';
  }

  await recordFrontDeskEvent({
    tenantId,
    eventType: 'booking_created',
    eventCategory: 'booking',
    channel,
    actorRole: 'customer',
    customerId: customer?.id ?? null,
    reservationId: reservation.id,
    serviceId: service_id,
    staffId: tenant_staff_id ?? null,
    amount: Number(serviceRow?.price ?? 0),
    currency: 'NGN',
    statusTo: reservationStatus,
    metadata: {
      source: 'whatsapp_v2_confirm',
      lock_id: lock_id ?? null,
    },
  });

  await captureServerAnalyticsEvent({
    event: ANALYTICS_EVENTS.BOOKING_COMPLETED,
    properties: {
      tenant_id: tenantId,
      channel,
      flow: 'booking',
      service_id,
      reservation_id: reservation.id,
      customer_id: customer?.id ?? null,
      staff_id: tenant_staff_id ?? null,
      time_to_complete_seconds: bookingStartedAt
        ? Math.max(0, Math.round((Date.now() - new Date(bookingStartedAt).getTime()) / 1000))
        : null,
      metadata: {
        requires_deposit: requiresDeposit,
        reservation_status: reservationStatus,
      },
    },
    distinctId: externalId,
  });

  if (requiresDeposit) {
    const paymentService = new PaymentService(supabaseAdmin);
    const customerEmail = getCustomerEmail(customer?.email ?? null, phone);
    const paymentResult = await paymentService.initializePayment({
      tenantId,
      amount: depositAmountCents,
      currency: 'NGN',
      email: customerEmail,
      reservationId: reservation?.id ?? `${tenantId}_${phone}_${startAt}`,
      provider: 'paystack',
      metadata: {
        type: 'deposit',
        reservation_id: reservation?.id,
        booking_noun: 'appointment',
      },
      bearer: 'account',
    });

    if (!paymentResult.success || !paymentResult.authorizationUrl) {
      console.error('[customerBooking] deposit initialization failed', {
        tenantId,
        reservationId: reservation?.id,
        error: paymentResult.error,
      });
      await supabaseAdmin
        .from('reservations')
        .update({ status: 'cancelled' })
        .eq('id', reservation?.id);
      if (lock_id) await releaseLock(lock_id);
      await resetConversation(externalId, tenantId, channel);
      return 'Sorry, we could not create your deposit link right now. Please try again.';
    }

    await recordFrontDeskEvent({
      tenantId,
      eventType: 'payment_requested',
      eventCategory: 'payment',
      channel,
      actorRole: 'system',
      customerId: customer?.id ?? null,
      reservationId: reservation.id,
      serviceId: service_id,
      amount: depositAmountCents / 100,
      currency: 'NGN',
      metadata: {
        provider: 'paystack',
        authorization_url: paymentResult.authorizationUrl,
      },
    });

    await captureServerAnalyticsEvent({
      event: ANALYTICS_EVENTS.PAYMENT_REQUESTED,
      properties: {
        tenant_id: tenantId,
        channel,
        flow: 'payment',
        provider: 'paystack',
        service_id,
        reservation_id: reservation.id,
        customer_id: customer?.id ?? null,
        metadata: {
          amount_cents: depositAmountCents,
        },
      },
      distinctId: externalId,
    });

    if (lock_id) await releaseLock(lock_id);
    await resetConversation(externalId, tenantId, channel);
    await updateChatJourneyByExternalId({
      tenantId,
      externalId,
      patch: {
        type: 'booking',
        stage: 'pending_deposit',
      },
    }).catch(() => undefined);

    return `Almost done! To secure your appointment, please pay the ₦${Math.round(depositAmountCents / 100).toLocaleString()} deposit: ${paymentResult.authorizationUrl}\n\nYour slot is held for 30 minutes.`;
  }

  // Release slot lock
  if (lock_id) await releaseLock(lock_id);

  // Update customer stats
  if (customer?.id) {
    await supabaseAdmin
      .from('customers')
      .update({ last_visit: new Date().toISOString(), total_bookings: (customer.total_bookings ?? 0) + 1 })
      .eq('id', customer.id);
  }

  // Queue reminders
  await queueReminders(tenantId, startAt, phone, service_id);

  // Reset flow
  await resetConversation(externalId, tenantId, channel);
  await updateChatJourneyByExternalId({
    tenantId,
    externalId,
    patch: {
      type: 'booking',
      stage: 'confirmed',
    },
  }).catch(() => undefined);

  const { data: tenantData } = await supabaseAdmin
    .from('tenants')
    .select('name, metadata, tone_config')
    .eq('id', tenantId)
    .maybeSingle();

  const tenantSettings = getTenantSettings(tenantData);
  const bookingNoun = String(tenantSettings.booking_noun ?? 'appointment');
  const dateFormatted = new Date(date).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'long' });

  return `Booked! ✅ Your ${bookingNoun} at *${tenantData?.name ?? 'the salon'}* is confirmed for ${dateFormatted} at ${formatTime(start_time)}.\n\nI'll send you a reminder 24 hours and 2 hours before. See you then!`;
}

// ─── Cancel booking ───────────────────────────────────────────────────────────

async function handleCancelBooking(
  externalId: string,
  tenantId: string,
  aiResp: AIResponse,
  channel: ConvChannel = 'whatsapp'
): Promise<string> {
  // For the cancel action, customerPhone is used to look up reservations.
  // For IG, the IGSID is stored as the phone identifier in the customer record.
  const execResult = await executeAction(tenantId, aiResp, {
    customerPhone: externalId,
    channel,
    userRole: 'customer',
  });
  await resetConversation(externalId, tenantId, channel);
  return execResult.success ? aiResp.reply : `Couldn't cancel: ${execResult.error ?? 'unknown error'}`;
}

async function handleShowCatalog(
  externalId: string,
  tenantId: string,
  aiResp: AIResponse
): Promise<string> {
  const execResult = await executeAction(tenantId, aiResp, {
    customerPhone: externalId,
    channel: 'whatsapp',
    userRole: 'customer',
  });
  if (!execResult.success) {
    return execResult.error
      ? `I couldn't load the catalog right now: ${execResult.error}`
      : 'I couldn’t load the catalog right now.';
  }

  if ((execResult.data as { delivery?: string } | undefined)?.delivery === 'interactive') {
    return '';
  }

  return formatProductActionReply(aiResp.reply, execResult.data as { title?: string; products?: Array<Record<string, unknown>> } | undefined, {
    emptyFallback: 'I couldn’t find any active products to show right now.',
  });
}

async function handleShowShowcase(
  externalId: string,
  tenantId: string,
  aiResp: AIResponse
): Promise<string> {
  const execResult = await executeAction(tenantId, aiResp, {
    customerPhone: externalId,
    channel: 'whatsapp',
    userRole: 'customer',
  });
  if (!execResult.success) {
    return execResult.error
      ? `I couldn't send the showcase right now: ${execResult.error}`
      : 'I couldn’t send the showcase right now.';
  }

  // The showcase pack service already sends the intro, media items, and CTA.
  // Returning an empty string prevents the pipeline from sending a duplicate text.
  return '';
}

async function handleRecommendProducts(
  externalId: string,
  tenantId: string,
  aiResp: AIResponse
): Promise<string> {
  const execResult = await executeAction(tenantId, aiResp, {
    customerPhone: externalId,
    channel: 'whatsapp',
    userRole: 'customer',
  });
  if (!execResult.success) {
    return execResult.error
      ? `I couldn't pull product recommendations right now: ${execResult.error}`
      : 'I couldn’t pull product recommendations right now.';
  }

  if ((execResult.data as { delivery?: string } | undefined)?.delivery === 'interactive') {
    return '';
  }

  return formatProductActionReply(aiResp.reply, execResult.data as { title?: string; products?: Array<Record<string, unknown>> } | undefined, {
    emptyFallback: 'I couldn’t find any suitable product recommendations right now.',
  });
}

async function handleOfferProducts(
  externalId: string,
  tenantId: string,
  aiResp: AIResponse,
  mode: 'upsell' | 'cross-sell',
  conv: ConvState,
  channel: ConvChannel = 'whatsapp'
): Promise<string> {
  const execResult = await executeAction(tenantId, aiResp, {
    customerPhone: externalId,
    channel,
    userRole: 'customer',
  });
  if (!execResult.success) {
    return execResult.error
      ? `I couldn't prepare ${mode} options right now: ${execResult.error}`
      : `I couldn’t prepare ${mode} options right now.`;
  }

  // Persist the offered products so a follow-up "yes" can be attributed as a
  // conversion (see handleCustomerRuleMatch 'affirm' → recordUpsellConversion).
  const offered = Array.isArray((execResult.data as { products?: Array<Record<string, unknown>> } | undefined)?.products)
    ? (execResult.data as { products: Array<Record<string, unknown>> }).products
    : [];
  if (offered.length > 0) {
    const productIds = offered.map((p) => String(p.id)).filter(Boolean);
    const totalCents = offered.reduce(
      (sum, p) => sum + (typeof p.price_cents === 'number' ? p.price_cents : Number(p.price_cents ?? 0)),
      0,
    );
    await updateConversation(externalId, tenantId, {
      flow_data: {
        ...conv.flow_data,
        pending_upsell: {
          mode: mode === 'upsell' ? 'upsell' : 'cross_sell',
          product_ids: productIds,
          total_cents: totalCents,
          offered_at: new Date().toISOString(),
        },
      },
    }, channel);
  }

  if ((execResult.data as { delivery?: string } | undefined)?.delivery === 'interactive') {
    return '';
  }

  return formatProductActionReply(
    aiResp.reply,
    execResult.data as { title?: string; products?: Array<Record<string, unknown>> } | undefined,
    {
      emptyFallback: mode === 'upsell'
        ? 'I couldn’t find any add-ons to suggest right now.'
        : 'I couldn’t find any complementary products to suggest right now.',
    }
  );
}

async function handleCreateRetailPaymentLink(
  externalId: string,
  tenantId: string,
  aiResp: AIResponse,
  conv: ConvState,
  channel: ConvChannel = 'whatsapp'
): Promise<string> {
  const execResult = await executeAction(tenantId, aiResp, {
    customerPhone: externalId,
    channel,
    userRole: 'customer',
  });
  if (!execResult.success) {
    return execResult.error
      ? `I couldn't create your payment link right now: ${execResult.error}`
      : 'I couldn’t create your payment link right now.';
  }

  const paymentLink = (execResult.data ?? {}) as {
    orderId?: string;
    paymentUrl?: string;
    reference?: string;
    totalCents?: number;
  };
  const totalCents = Number(paymentLink.totalCents ?? 0);

  await updateConversation(externalId, tenantId, {
    current_flow: conv.current_flow === 'booking' ? 'booking' : 'managing',
    flow_data: {
      ...conv.flow_data,
      sales_journey: {
        ...conv.flow_data?.sales_journey,
        stage: 'pending_payment',
        last_payment_reference: paymentLink.reference ?? null,
      },
      retail_order: {
        ...(conv.flow_data?.retail_order ?? {}),
        order_id: paymentLink.orderId ?? null,
        payment_reference: paymentLink.reference ?? null,
        payment_url: paymentLink.paymentUrl ?? null,
        payment_status: 'pending',
        fulfillment_status: 'unfulfilled',
        total_cents: totalCents || null,
      },
    },
  }, channel);

  if (!paymentLink.paymentUrl) {
    return aiResp.reply;
  }

  return `${aiResp.reply}\n\nPay here to complete your order: ${paymentLink.paymentUrl}${totalCents > 0 ? `\nAmount: ₦${Math.round(totalCents / 100).toLocaleString()}` : ''}\n\nOnce payment goes through, I’ll confirm it right here.`;
}

async function recordUpsellConversion(
  externalId: string,
  tenantId: string,
  conv: ConvState,
  channel: ConvChannel = 'whatsapp'
): Promise<string> {
  const pending = conv.flow_data?.pending_upsell as
    | { mode?: string; product_ids?: string[]; total_cents?: number; offered_at?: string }
    | undefined;
  const mode = pending?.mode === 'cross_sell' ? 'cross_sell' : 'upsell';
  const productIds = Array.isArray(pending?.product_ids) ? pending!.product_ids! : [];
  const totalCents = typeof pending?.total_cents === 'number' ? pending!.total_cents! : 0;

  // Attribution: monetary value in major units (fallback to 1 if unknown).
  await siasOperations.recordOutcomeAttribution({
    tenantId,
    customerPhone: externalId,
    signal: 'upsell_conversion',
    sourceEvent: `frontdesk.${mode}.accepted`,
    value: totalCents > 0 ? totalCents / 100 : 1,
    metadata: { product_ids: productIds, mode, offered_at: pending?.offered_at ?? null },
  }).catch(() => undefined);

  await recordFrontDeskEvent({
    tenantId,
    eventType: mode === 'upsell' ? 'upsell_accepted' : 'cross_sell_accepted',
    eventCategory: 'sales',
    channel,
    actorRole: 'customer',
    amount: totalCents > 0 ? totalCents : null,
    metadata: { product_ids: productIds, mode },
  }).catch(() => undefined);

  // Clear the pending offer so the same "yes" isn't counted twice.
  await updateConversation(externalId, tenantId, {
    flow_data: { ...conv.flow_data, pending_upsell: null },
  }, channel);

  const retail = await addProductsToRetailCart({
    tenantId,
    externalId,
    productIds,
    source: mode === 'cross_sell' ? 'cross_sell' : 'upsell',
  }).catch(() => null);

  if (retail) {
    return `Great choice! 🎉 I’ve added that to your draft order. Current total: ₦${Math.round(retail.totalCents / 100).toLocaleString()}. Anything else I can help with?`;
  }

  return 'Great choice! 🎉 I’ve noted that for you — the team will add it to your order. Anything else I can help with?';
}

async function handleQualifyLead(
  externalId: string,
  tenantId: string,
  aiResp: AIResponse,
  conv: ConvState,
  channel: ConvChannel = 'whatsapp'
): Promise<string> {
  const execResult = await executeAction(tenantId, aiResp, {
    customerPhone: externalId,
    channel,
    userRole: 'customer',
  });

  await updateConversation(externalId, tenantId, {
    current_flow: conv.current_flow === 'booking' ? 'booking' : 'managing',
    flow_data: {
      ...conv.flow_data,
      sales_journey: {
        stage: 'qualified',
        desired_outcome: aiResp.params?.desired_outcome ?? null,
        budget: aiResp.params?.budget ?? null,
        preferred_timing: aiResp.params?.preferred_timing ?? null,
        urgency: aiResp.params?.urgency ?? null,
        previous_experience: aiResp.params?.previous_experience ?? null,
      },
    },
  }, channel);

  return execResult.success ? aiResp.reply : (execResult.error ?? aiResp.reply);
}

async function handleSendQuote(
  externalId: string,
  tenantId: string,
  aiResp: AIResponse,
  conv: ConvState,
  channel: ConvChannel = 'whatsapp'
): Promise<string> {
  const execResult = await executeAction(tenantId, aiResp, {
    customerPhone: externalId,
    channel,
    userRole: 'customer',
  });
  if (!execResult.success) {
    return execResult.error
      ? `I couldn't prepare a quote right now: ${execResult.error}`
      : 'I couldn’t prepare a quote right now.';
  }

  const data = (execResult.data as { quote?: { name?: string; price?: number; duration?: number } } | undefined)?.quote;
  await updateConversation(externalId, tenantId, {
    current_flow: conv.current_flow === 'booking' ? 'booking' : 'managing',
    flow_data: {
      ...conv.flow_data,
      sales_journey: {
        ...conv.flow_data?.sales_journey,
        stage: 'quoted',
        quoted_service: data?.name ?? aiResp.params?.service_name ?? null,
      },
    },
  }, channel);

  if (!data) return aiResp.reply;

  return `${aiResp.reply}\n\n*${data.name ?? 'Service quote'}*\nPrice: ₦${Math.round(Number(data.price ?? 0)).toLocaleString()}\nDuration: ${Number(data.duration ?? 60)} minutes`;
}

async function handleRecoverLead(
  externalId: string,
  tenantId: string,
  aiResp: AIResponse,
  conv: ConvState,
  channel: ConvChannel = 'whatsapp'
): Promise<string> {
  const execResult = await executeAction(tenantId, aiResp, {
    customerPhone: externalId,
    channel,
    userRole: 'customer',
  });

  await updateConversation(externalId, tenantId, {
    current_flow: conv.current_flow === 'booking' ? 'booking' : 'managing',
    flow_data: {
      ...conv.flow_data,
      sales_journey: {
        ...conv.flow_data?.sales_journey,
        stage: 'followup_scheduled',
        follow_up_at: aiResp.params?.follow_up_at ?? null,
        recovery_reason: aiResp.params?.reason ?? null,
      },
    },
  }, channel);

  return execResult.success ? aiResp.reply : (execResult.error ?? aiResp.reply);
}

// ─── Greetings ────────────────────────────────────────────────────────────────

async function getCustomerGreeting(tenantId: string, externalId: string): Promise<string> {
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('name, metadata, tone_config')
    .eq('id', tenantId)
    .maybeSingle();

  const customer = await findCustomerByPhone(
    supabaseAdmin,
    tenantId,
    externalId,
    'id, name, customer_name, merged_into',
  );

  const salonName = tenant?.name ?? 'us';
  const tenantSettings = getTenantSettings(tenant);
  const bookingNoun = String(tenantSettings.booking_noun ?? 'appointment');
  const customerName = customer?.name ?? customer?.customer_name ?? null;
  const { data: customerProfile } = customer?.id
    ? await supabaseAdmin
        .from('customer_profile_summary')
        .select('lifetime_bookings')
        .eq('tenant_id', tenantId)
        .eq('customer_id', customer.id)
        .maybeSingle()
    : { data: null };

  if (customerName && Number(customerProfile?.lifetime_bookings ?? 0) > 0) {
    return `Hi ${customerName}! Welcome back to *${salonName}* 😊\nI can help you book another ${bookingNoun}, recommend the right service, or suggest products that fit your last visit. What would you like today?`;
  }

  return `Hi! Welcome to *${salonName}* 😊\nI can help you book a ${bookingNoun}, compare options, recommend services, or show you products. What are you trying to get done today?`;
}

async function getCustomerHelp(tenantId: string): Promise<string> {
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('metadata, tone_config')
    .eq('id', tenantId)
    .maybeSingle();

  const tenantSettings = getTenantSettings(tenant);
  const bookingNoun = String(tenantSettings.booking_noun ?? 'appointment');
  return `I can help you:\n  • Book a ${bookingNoun}\n  • Check prices or get a quote\n  • Compare services and recommend the best option\n  • Suggest add-ons or products\n  • Cancel or reschedule\n\nTell me what you're trying to achieve and I'll guide you.`;
}

// ─── Reminder queuing ─────────────────────────────────────────────────────────

async function queueReminders(
  tenantId: string,
  startAt: string,
  customerPhone: string,
  serviceId: string
): Promise<void> {
  const appointmentTime = new Date(startAt).getTime();
  const reminder24h = new Date(appointmentTime - 24 * 60 * 60 * 1000);
  const reminder2h = new Date(appointmentTime - 2 * 60 * 60 * 1000);

  const rows = [
    {
      tenant_id: tenantId,
      message_type: 'reminder_24h',
      payload: JSON.stringify({ customer_phone: customerPhone, service_id: serviceId, appointment_at: startAt }),
      scheduled_at: reminder24h.toISOString(),
      status: 'pending',
      priority: 5,
    },
    {
      tenant_id: tenantId,
      message_type: 'reminder_2h',
      payload: JSON.stringify({ customer_phone: customerPhone, service_id: serviceId, appointment_at: startAt }),
      scheduled_at: reminder2h.toISOString(),
      status: 'pending',
      priority: 5,
    },
  ];

  await supabaseAdmin.from('whatsapp_message_queue').insert(rows);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')}${period}`;
}

function getDepositConfig(settings: Record<string, unknown> | undefined): { enabled?: boolean; amount_cents?: number } | null {
  const depositConfig = settings?.deposit_config;
  if (!depositConfig || typeof depositConfig !== 'object') return null;

  const config = depositConfig as Record<string, unknown>;
  return {
    enabled: Boolean(config.enabled),
    amount_cents: typeof config.amount_cents === 'number' ? config.amount_cents : undefined,
  };
}

function getCustomerEmail(email: string | null, phone: string): string {
  if (email && email.trim()) return email.trim();
  const cleanPhone = phone.replace(/\D/g, '');
  return `noemail+${cleanPhone || 'customer'}@example.com`;
}

function formatProductActionReply(
  aiReply: string,
  payload: { title?: string; products?: Array<Record<string, unknown>> } | undefined,
  options: { emptyFallback: string }
): string {
  const products = Array.isArray(payload?.products) ? payload?.products : [];
  if (products.length === 0) {
    return options.emptyFallback;
  }

  const heading = typeof payload?.title === 'string' && payload.title.trim()
    ? `\n\n*${payload.title.trim()}*`
    : '';

  const lines = products.slice(0, 5).map((product, index) => {
    const name = typeof product.name === 'string' ? product.name : `Product ${index + 1}`;
    const price = typeof product.price_cents === 'number' && Number.isFinite(product.price_cents)
      ? `₦${Math.round(product.price_cents / 100).toLocaleString()}`
      : 'Price on request';
    const stock = product.track_inventory
      ? (typeof product.stock_quantity === 'number' && product.stock_quantity > 0 ? 'In stock' : 'Out of stock')
      : 'Stock status unknown';
    const description = typeof product.description === 'string' && product.description.trim()
      ? ` — ${product.description.trim()}`
      : '';

    return `${index + 1}. *${name}* — ${price} (${stock})${description}`;
  });

  return `${aiReply}${heading}\n${lines.join('\n')}`.trim();
}
