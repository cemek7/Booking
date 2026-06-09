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

import { createClient } from '@supabase/supabase-js';
import PaymentService from '@/lib/paymentService';
import { executeAction, AIResponse } from '../actionValidator';
import { updateConversation, resetConversation, ConvState, ConvChannel } from '../conversationState';
import { getAvailableSlots, lockSlot, releaseLock } from '../slotEngine';
import { addToWaitlist } from '../waitlist';
import { defaultLogger } from '@/lib/logger';
import type { RuleMatch } from '@/lib/ai/rulesEngine';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
      // Confirm a pending booking
      if (conv.flow_data?.pending_confirmation) {
        return confirmBooking(externalId, tenantId, conv, channel);
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
  const { service_id, tenant_staff_id, date } = aiResp.params;

  if (!service_id || !date) return aiResp.reply;

  const slots = await getAvailableSlots(tenantId, tenant_staff_id, date, service_id);
  const available = slots.filter((s) => s.available);

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
  const { service_id, tenant_staff_id, date, start_time, end_time, customer_name } = aiResp.params;

  if (!service_id || !date || !start_time) return aiResp.reply;

  // Lock the slot
  const lockId = await lockSlot(tenantId, tenant_staff_id, date, start_time, end_time ?? start_time, phone);

  // Get service + staff details for confirmation message
  const [{ data: service }, { data: staff }] = await Promise.all([
    supabaseAdmin.from('services').select('name, price_cents').eq('id', service_id).maybeSingle(),
    tenant_staff_id
      ? supabaseAdmin.from('tenant_users').select('phone').eq('id', tenant_staff_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const { data: tenantData } = await supabaseAdmin
    .from('tenants')
    .select('settings, name')
    .eq('id', tenantId)
    .maybeSingle();

  const bookingNoun = tenantData?.settings?.booking_noun ?? 'appointment';
  const price = service ? `₦${Math.round((service.price_cents ?? 0) / 100).toLocaleString()}` : '';
  const depositConfig = getDepositConfig(tenantData?.settings);
  const { data: customerProfile } = await supabaseAdmin
    .from('customers')
    .select('email, risk_score')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .maybeSingle();
  const riskScore = ((customerProfile?.risk_score as string | undefined) ?? 'low') as 'low' | 'medium' | 'high';
  const requiresDeposit = riskScore === 'high' || Boolean(depositConfig?.enabled);
  const depositAmountCents =
    requiresDeposit
      ? (depositConfig?.amount_cents && depositConfig.amount_cents > 0
          ? depositConfig.amount_cents
          : Math.max(service?.price_cents ?? 0, 2500))
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
  const requiresDeposit = Boolean(pending.deposit_required);
  const depositAmountCents = Number(pending.deposit_amount_cents ?? 0);

  // Upsert customer record
  const { data: customer } = await supabaseAdmin
    .from('customers')
    .upsert({ tenant_id: tenantId, phone, name: customer_name ?? null }, { onConflict: 'tenant_id,phone' })
    .select('id, total_bookings, email')
    .single();

  // Create reservation
  const startAt = `${date}T${start_time}:00`;
  const endAt = end_time ? `${date}T${end_time}:00` : startAt;
  const reservationStatus = requiresDeposit ? 'deposit_pending' : 'confirmed';

  const { data: reservation, error } = await supabaseAdmin.from('reservations').insert({
    tenant_id: tenantId,
    tenant_staff_id,
    service_id,
    customer_id: customer?.id ?? null,
    customer_name: customer_name ?? phone,
    customer_phone: phone,
    start_at: startAt,
    end_at: endAt,
    status: reservationStatus,
    confirmed_at: requiresDeposit ? null : new Date().toISOString(),
  }).select('id').single();

  if (error) {
    console.error('[customerBooking] confirmBooking error', error);
    return 'Sorry, something went wrong confirming your booking. Please try again.';
  }

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

    if (lock_id) await releaseLock(lock_id);
    await resetConversation(externalId, tenantId, channel);

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

  const { data: tenantData } = await supabaseAdmin
    .from('tenants')
    .select('name, settings')
    .eq('id', tenantId)
    .maybeSingle();

  const bookingNoun = tenantData?.settings?.booking_noun ?? 'appointment';
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
  const execResult = await executeAction(tenantId, aiResp, { customerPhone: externalId });
  await resetConversation(externalId, tenantId, channel);
  return execResult.success ? aiResp.reply : `Couldn't cancel: ${execResult.error ?? 'unknown error'}`;
}

// ─── Greetings ────────────────────────────────────────────────────────────────

async function getCustomerGreeting(tenantId: string, externalId: string): Promise<string> {
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('name, settings')
    .eq('id', tenantId)
    .maybeSingle();

  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('name, total_bookings')
    .eq('tenant_id', tenantId)
    .eq('phone', externalId)
    .maybeSingle();

  const salonName = tenant?.name ?? 'us';
  const bookingNoun = tenant?.settings?.booking_noun ?? 'appointment';

  if (customer?.name && (customer.total_bookings ?? 0) > 0) {
    return `Hi ${customer.name}! Welcome back to *${salonName}* 😊\nWould you like to book another ${bookingNoun}?`;
  }

  return `Hi! Welcome to *${salonName}* 😊\nI can help you book a ${bookingNoun}. What service are you interested in?`;
}

async function getCustomerHelp(tenantId: string): Promise<string> {
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle();

  const bookingNoun = tenant?.settings?.booking_noun ?? 'appointment';
  return `I can help you:\n  • Book a ${bookingNoun}\n  • Check service prices\n  • Cancel or reschedule\n\nJust tell me what you need!`;
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
