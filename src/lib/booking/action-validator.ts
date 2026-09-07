/**
 * Booking Action Validator
 *
 * Channel-agnostic validation and execution layer for AI-proposed booking actions.
 * WhatsApp v2 currently consumes this module first; legacy path re-exports remain
 * in place until the rest of the channel surface is fully migrated.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { recordFrontDeskEvent } from '@/lib/ai/front-desk-events';
import { scheduleLeadRecoveryCampaign, upsertLeadRecord } from '@/lib/ai/front-desk-sales';
import { cancelReservation, createReservation, rescheduleReservation } from '@/lib/reservationService';
import { sendShowcasePack } from '@/lib/whatsapp/showcasePackService';
import { getTenantWhatsAppProviderClient } from '@/lib/whatsapp/providers/providerSelection';
import {
  buildProductDetailsMessage,
  buildProductListMessage,
  buildRecommendationsMessage,
} from '@/lib/whatsapp/product-service';
import { updateChatJourneyByExternalId } from '@/lib/chats/journey-service';
import { createRetailOrderPaymentLinkForCustomer } from '@/lib/commerce/retail-orders';
import { dispatchExecute, dispatchValidate } from '@/lib/booking/handlers/registry';
import type { Product } from '@/types/product-catalogue';

const supabaseAdmin = createSupabaseAdminClient();

export type AIAction =
  | 'create_booking'
  | 'get_availability'
  | 'list_services'
  | 'list_staff'
  | 'get_price'
  | 'send_quote'
  | 'qualify_lead'
  | 'show_catalog'
  | 'show_showcase'
  | 'recommend_products'
  | 'offer_upsell'
  | 'offer_cross_sell'
  | 'create_retail_payment_link'
  | 'add_product'
  | 'adjust_stock'
  | 'set_price'
  | 'set_availability'
  | 'low_stock_query'
  | 'record_retail_sale'
  | 'record_expense'
  | 'record_purchase'
  | 'record_supplier_payment'
  | 'record_stock_receipt'
  | 'create_stock_count_session'
  | 'complete_service_capture'
  | 'refund_sale'
  | 'record_outstanding_balance'
  | 'create_order'
  | 'set_order_fulfillment'
  | 'add_delivery_fee'
  | 'cancel_order_restock'
  | 'lapsed_customers_query'
  | 'add_customer_note'
  | 'customer_history'
  | 'set_customer_tag'
  | 'staff_sales_query'
  | 'staff_discount_query'
  | 'set_staff_capability'
  | 'recover_lead'
  | 'cancel_booking'
  | 'reschedule_booking'
  | 'mark_no_show'
  | 'add_service'
  | 'update_service'
  | 'add_staff'
  | 'update_schedule'
  | 'block_slot'
  | 'walk_in'
  | 'get_insights'
  | 'owner_query'
  | 'owner_analytics_query'
  | 'general_reply'
  | 'needs_info'
  | 'escalate';

export interface AIResponse {
  action: AIAction;
  params: Record<string, unknown>;
  reply: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  retryContext?: string;
}

export async function validateAction(
  tenantId: string,
  aiResponse: AIResponse
): Promise<ValidationResult> {
  const { action, params } = aiResponse;
  const registryResult = await dispatchValidate(
    supabaseAdmin as unknown as import('@supabase/supabase-js').SupabaseClient,
    tenantId,
    action,
    params as Record<string, unknown>,
    {}
  );

  if (registryResult.handled && registryResult.result) {
    return registryResult.result;
  }

  switch (action) {
    case 'create_booking':
      return validateCreateBooking(tenantId, params);

    case 'cancel_booking':
    case 'reschedule_booking':
    case 'mark_no_show':
      return validateReservationOwnership(tenantId, typeof params.reservation_id === 'string' ? params.reservation_id : undefined);

    case 'update_service':
      return validateServiceOwnership(tenantId, typeof params.service_id === 'string' ? params.service_id : undefined);

    case 'add_service':
      return params.name && params.price !== undefined
        ? { valid: true }
        : { valid: false, error: 'add_service requires name and price', retryContext: 'The service must have a name and a price.' };

    case 'add_staff':
      return params.name
        ? { valid: true }
        : { valid: false, error: 'add_staff requires name', retryContext: 'The staff member must have a name.' };

    case 'send_quote':
      return params.service_id || params.service_name
        ? { valid: true }
        : { valid: false, error: 'send_quote requires a service identifier', retryContext: 'Please specify which service you are quoting.' };

    case 'recover_lead':
      return params.reason || params.follow_up_at || params.customer_phone
        ? { valid: true }
        : { valid: false, error: 'recover_lead requires a reason or follow-up timing', retryContext: 'Explain why the lead should be recovered and when to follow up.' };

    case 'create_retail_payment_link':
      return { valid: true };

    case 'update_schedule':
    case 'block_slot':
      return params.tenant_staff_id || params.staff_name
        ? { valid: true }
        : { valid: false, error: 'update_schedule requires staff identifier', retryContext: 'Please specify which staff member to update.' };

    case 'walk_in':
      return validateWalkIn(tenantId, params);

    case 'record_expense':
    case 'record_purchase':
    case 'record_supplier_payment':
    case 'record_stock_receipt':
    case 'create_stock_count_session':
    case 'complete_service_capture':
      return { valid: true };

    case 'get_availability':
    case 'list_services':
    case 'list_staff':
    case 'get_price':
    case 'send_quote':
    case 'qualify_lead':
    case 'show_catalog':
    case 'show_showcase':
    case 'recommend_products':
    case 'offer_upsell':
    case 'offer_cross_sell':
    case 'create_retail_payment_link':
    case 'recover_lead':
    case 'get_insights':
    case 'owner_query':
    case 'owner_analytics_query':
    case 'general_reply':
    case 'needs_info':
    case 'escalate':
      return { valid: true };

    default:
      return { valid: false, error: `Unknown action: ${action}`, retryContext: `The action "${action}" is not supported.` };
  }
}

async function validateCreateBooking(
  tenantId: string,
  params: Record<string, unknown>
): Promise<ValidationResult> {
  const required = ['service_id', 'start_at'];
  for (const field of required) {
    if (!params[field]) {
      return {
        valid: false,
        error: `create_booking missing required field: ${field}`,
        retryContext: 'A booking requires at least a service and a start time.',
      };
    }
  }

  if (params.tenant_staff_id && params.date && params.start_time) {
    const { data: existingLock } = await supabaseAdmin
      .from('slot_locks')
      .select('id, customer_phone')
      .eq('tenant_staff_id', params.tenant_staff_id)
      .eq('date', params.date)
      .lte('start_time', params.start_time)
      .gt('end_time', params.start_time)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (existingLock && existingLock.customer_phone !== params.customer_phone) {
      return {
        valid: false,
        error: 'Slot is currently held by another customer',
        retryContext: 'That time slot is temporarily held by another customer. Please suggest a different time.',
      };
    }
  }

  return { valid: true };
}

async function validateReservationOwnership(
  tenantId: string,
  reservationId: string | undefined
): Promise<ValidationResult> {
  if (!reservationId) {
    return {
      valid: false,
      error: 'reservation_id is required',
      retryContext: 'Please specify which booking to modify.',
    };
  }

  const { data } = await supabaseAdmin
    .from('reservations')
    .select('id')
    .eq('id', reservationId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!data) {
    return {
      valid: false,
      error: 'Reservation not found or not owned by this tenant',
      retryContext: 'That booking does not exist or belongs to a different business.',
    };
  }

  return { valid: true };
}

async function validateServiceOwnership(
  tenantId: string,
  serviceId: string | undefined
): Promise<ValidationResult> {
  if (!serviceId) {
    return {
      valid: false,
      error: 'service_id is required',
      retryContext: 'Please specify which service to update.',
    };
  }

  const { data } = await supabaseAdmin
    .from('services')
    .select('id')
    .eq('id', serviceId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!data) {
    return {
      valid: false,
      error: 'Service not found or not owned by this tenant',
      retryContext: 'That service does not exist in your business profile.',
    };
  }

  return { valid: true };
}

async function validateWalkIn(
  tenantId: string,
  params: Record<string, unknown>
): Promise<ValidationResult> {
  let staffId = typeof params.tenant_staff_id === 'string'
    ? params.tenant_staff_id
    : (typeof params.staff_id === 'string' ? params.staff_id : undefined);

  if (!staffId && params.staff_name) {
    const { data: staff } = await supabaseAdmin
      .from('tenant_users')
      .select('id')
      .eq('tenant_id', tenantId)
      .ilike('name', `%${params.staff_name}%`)
      .maybeSingle();
    staffId = staff?.id;
  }

  if (!staffId) {
    return {
      valid: false,
      error: 'walk_in requires a staff identifier',
      retryContext: 'Could not find that staff member. Please specify their phone number or the exact name shown in the staff list.',
    };
  }

  let serviceId = typeof params.service_id === 'string' ? params.service_id : undefined;
  let durationMinutes = 60;

  if (!serviceId && params.service_name) {
    const { data: svc } = await supabaseAdmin
      .from('services')
      .select('id, duration')
      .eq('tenant_id', tenantId)
      .ilike('name', `%${params.service_name}%`)
      .maybeSingle();
    serviceId = svc?.id;
    durationMinutes = svc?.duration ?? 60;
  } else if (serviceId) {
    const { data: svc } = await supabaseAdmin
      .from('services')
      .select('duration')
      .eq('id', serviceId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    durationMinutes = svc?.duration ?? 60;
  }

  const now = new Date();
  const walkInEnd = new Date(now.getTime() + durationMinutes * 60 * 1000);

  const { data: conflict } = await supabaseAdmin
    .from('reservations')
    .select('start_at, end_at, customer_id, customer_number')
    .eq('tenant_id', tenantId)
    .eq('tenant_staff_id', staffId)
    .in('status', ['confirmed', 'pending'])
    .lt('start_at', walkInEnd.toISOString())
    .gt('end_at', now.toISOString())
    .maybeSingle();

  if (conflict) {
    const conflictEnd = new Date(conflict.end_at as string).toLocaleTimeString('en-NG', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos',
    });
    const customerName = (conflict.customer_number as string) ?? 'another customer';
    return {
      valid: false,
      error: `Staff has an active booking until ${conflictEnd}`,
      retryContext: `That staff member is currently booked with ${customerName} until ${conflictEnd}. The walk-in will need to wait or be assigned to another available staff member.`,
    };
  }

  params.resolved_staff_id = staffId;
  params.resolved_service_id = serviceId;
  params.walk_in_start_at = now.toISOString();
  params.walk_in_end_at = walkInEnd.toISOString();

  return { valid: true };
}

async function resolveCustomerIdForNoShow(
  tenantId: string,
  reservationId: string | undefined,
  fallbackCustomerId?: string
): Promise<string | null> {
  if (fallbackCustomerId) return fallbackCustomerId;
  if (!reservationId) return null;

  const { data } = await supabaseAdmin
    .from('reservations')
    .select('customer_id')
    .eq('id', reservationId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  return typeof data?.customer_id === 'string' ? data.customer_id : null;
}

async function lookupServiceQuote(
  tenantId: string,
  params: Record<string, unknown>
): Promise<{ id: string; name: string; price: number; duration: number } | null> {
  if (typeof params.service_id === 'string') {
    const { data } = await supabaseAdmin
      .from('services')
      .select('id, name, price, duration')
      .eq('tenant_id', tenantId)
      .eq('id', params.service_id)
      .eq('is_active', true)
      .maybeSingle();

    if (data?.id) {
      return {
        id: String(data.id),
        name: String(data.name ?? 'Service'),
        price: Number(data.price ?? 0),
        duration: Number(data.duration ?? 60),
      };
    }
  }

  if (typeof params.service_name === 'string' && params.service_name.trim()) {
    const { data } = await supabaseAdmin
      .from('services')
      .select('id, name, price, duration')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .ilike('name', `%${params.service_name.trim()}%`)
      .order('sort_order', { ascending: true })
      .maybeSingle();

    if (data?.id) {
      return {
        id: String(data.id),
        name: String(data.name ?? 'Service'),
        price: Number(data.price ?? 0),
        duration: Number(data.duration ?? 60),
      };
    }
  }

  return null;
}

export async function executeAction(
  tenantId: string,
  aiResponse: AIResponse,
  context: {
    actorId?: string | null;
    permissions?: string[];
    customerPhone?: string;
    tenantStaffId?: string;
    customerId?: string;
    messageId?: string;
    channel?: string;
    userRole?: 'owner' | 'staff' | 'customer';
  }
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const { action } = aiResponse;
  // AI action payloads are validated before execution. Keep the dynamic boundary
  // here rather than leaking `unknown` through every domain service call below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: Record<string, any> = aiResponse.params;

  try {
    const registryResult = await dispatchExecute(
      supabaseAdmin as unknown as import('@supabase/supabase-js').SupabaseClient,
      tenantId,
      action,
      params as Record<string, unknown>,
      {
        channel: context.channel,
        actorId: context.actorId ?? context.customerId ?? null,
        permissions: context.permissions,
        role: context.userRole,
        customerPhone: context.customerPhone,
        tenantStaffId: context.tenantStaffId,
        customerId: context.customerId,
        messageId: context.messageId,
        userRole: context.userRole,
      }
    );

    if (registryResult.handled && registryResult.result) {
      return {
        success: registryResult.result.success,
        error: registryResult.result.error,
        data: registryResult.result.data ?? (registryResult.result.reply ? { reply: registryResult.result.reply } : undefined),
      };
    }

    switch (action) {
      case 'create_booking': {
        const startAt = params.start_at;
        const endAt = params.end_at ?? new Date(new Date(startAt).getTime() + 60 * 60 * 1000).toISOString();
        const quotedService = params.service_id
          ? await lookupServiceQuote(tenantId, { service_id: params.service_id })
          : null;
        const reservation = await createReservation(supabaseAdmin, {
          tenant_id: tenantId,
          customer_id: params.customer_id ?? context.customerId ?? null,
          customer_name: params.customer_name,
          phone: params.customer_phone ?? context.customerPhone ?? null,
          service_id: params.service_id,
          service: params.service_name ?? params.service_id ?? null,
          start_at: startAt,
          end_at: endAt,
          status: 'confirmed',
          metadata: {
            source: 'whatsapp_v2_ai',
            action: 'create_booking',
          },
          staff_id: params.staff_id ?? params.tenant_staff_id ?? null,
        });
        await recordFrontDeskEvent({
          tenantId,
          eventType: 'booking_created',
          eventCategory: 'booking',
          channel: context.channel ?? 'whatsapp',
          actorRole: context.userRole ?? 'customer',
          customerId: typeof reservation?.customer_id === 'string' ? reservation.customer_id : (params.customer_id ?? context.customerId ?? null),
          reservationId: typeof reservation?.id === 'string' ? reservation.id : null,
          serviceId: params.service_id ?? null,
          staffId: params.staff_id ?? params.tenant_staff_id ?? null,
          messageId: context.messageId ?? null,
          correlationId: context.messageId ?? null,
          amount: quotedService?.price ?? null,
          currency: 'NGN',
          statusTo: 'confirmed',
          metadata: {
            source: 'ai_front_desk',
            action: 'create_booking',
            service_name: quotedService?.name ?? params.service_name ?? null,
          },
        });
        if (context.customerPhone) {
          await updateChatJourneyByExternalId({
            tenantId,
            externalId: context.customerPhone,
            patch: { type: 'booking', stage: 'confirmed' },
          }).catch(() => undefined);
        }
        return { success: true, data: { reservation } };
      }

      case 'cancel_booking': {
        const reservation = await cancelReservation(supabaseAdmin, {
          tenant_id: tenantId,
          reservation_id: params.reservation_id,
          reason: params.reason ?? null,
        });
        if (reservation) {
          await recordFrontDeskEvent({
            tenantId,
            eventType: 'booking_cancelled',
            eventCategory: 'booking',
            channel: context.channel ?? 'whatsapp',
            actorRole: context.userRole ?? 'customer',
            customerId: typeof reservation.customer_id === 'string' ? reservation.customer_id : (context.customerId ?? null),
            reservationId: params.reservation_id ?? null,
            messageId: context.messageId ?? null,
            correlationId: context.messageId ?? null,
            statusFrom: 'confirmed',
            statusTo: 'cancelled',
            metadata: { reason: params.reason ?? null },
          });
        }
        return { success: !!reservation, data: reservation, error: reservation ? undefined : 'Reservation not found' };
      }

      case 'mark_no_show': {
        const { error } = await supabaseAdmin
          .from('reservations')
          .update({ status: 'no_show' })
          .eq('id', params.reservation_id)
          .eq('tenant_id', tenantId);
        if (!error) {
          const customerId = await resolveCustomerIdForNoShow(tenantId, params.reservation_id, context.customerId);
          if (customerId) {
            const { data: customerRow } = await supabaseAdmin
              .from('customers')
              .select('no_show_count')
              .eq('id', customerId)
              .maybeSingle();

            const nextNoShowCount = Number((customerRow as { no_show_count?: number } | null)?.no_show_count ?? 0) + 1;
            const riskScore = nextNoShowCount >= 3 ? 'high' : nextNoShowCount >= 1 ? 'medium' : 'low';

            await supabaseAdmin
              .from('customers')
              .update({
                no_show_count: nextNoShowCount,
                risk_score: riskScore,
              })
              .eq('id', customerId);
          }
          await recordFrontDeskEvent({
            tenantId,
            eventType: 'booking_no_show',
            eventCategory: 'booking',
            channel: context.channel ?? 'whatsapp',
            actorRole: context.userRole ?? 'customer',
            customerId: customerId ?? context.customerId ?? null,
            reservationId: params.reservation_id ?? null,
            messageId: context.messageId ?? null,
            correlationId: context.messageId ?? null,
            statusTo: 'no_show',
          });
        }
        return { success: !error, error: error?.message };
      }

      case 'reschedule_booking': {
        const reservation = await rescheduleReservation(supabaseAdmin, {
          tenant_id: tenantId,
          reservation_id: params.reservation_id,
          start_at: params.new_start_at,
          end_at: params.new_end_at,
          staff_id: params.staff_id ?? params.tenant_staff_id ?? null,
          reason: params.reason ?? null,
        });
        if (reservation) {
          await recordFrontDeskEvent({
            tenantId,
            eventType: 'booking_rescheduled',
            eventCategory: 'booking',
            channel: context.channel ?? 'whatsapp',
            actorRole: context.userRole ?? 'customer',
            customerId: typeof reservation.customer_id === 'string' ? reservation.customer_id : (context.customerId ?? null),
            reservationId: params.reservation_id ?? null,
            serviceId: typeof reservation.service_id === 'string' ? reservation.service_id : null,
            staffId: params.staff_id ?? params.tenant_staff_id ?? null,
            messageId: context.messageId ?? null,
            correlationId: context.messageId ?? null,
            statusFrom: 'confirmed',
            statusTo: 'confirmed',
            metadata: { reason: params.reason ?? null, new_start_at: params.new_start_at ?? null },
          });
        }
        return { success: !!reservation, data: reservation, error: reservation ? undefined : 'Reservation not found' };
      }

      case 'qualify_lead': {
        const lead = await upsertLeadRecord({
          tenantId,
          phone: params.customer_phone ?? context.customerPhone ?? null,
          name: params.customer_name ?? null,
          intent: params.intent ?? params.desired_outcome ?? 'consultation',
          notes: [
            params.desired_outcome ? `Outcome: ${params.desired_outcome}` : null,
            params.budget ? `Budget: ${params.budget}` : null,
            params.preferred_timing ? `Timing: ${params.preferred_timing}` : null,
            params.urgency ? `Urgency: ${params.urgency}` : null,
            params.previous_experience ? `Previous experience: ${params.previous_experience}` : null,
            params.objection ? `Objection: ${params.objection}` : null,
          ].filter(Boolean).join('\n'),
          status: 'qualified',
          stage: 'qualified',
          source: 'ai_front_desk',
        });

        await recordFrontDeskEvent({
          tenantId,
          eventType: lead ? 'lead_qualified' : 'inquiry_received',
          eventCategory: lead ? 'lead' : 'conversation',
          channel: context.channel ?? 'whatsapp',
          actorRole: context.userRole ?? 'customer',
          customerId: context.customerId ?? null,
          messageId: context.messageId ?? null,
          correlationId: context.messageId ?? null,
          metadata: {
            lead_id: lead?.id ?? null,
            desired_outcome: params.desired_outcome ?? null,
            budget: params.budget ?? null,
            preferred_timing: params.preferred_timing ?? null,
            urgency: params.urgency ?? null,
            previous_experience: params.previous_experience ?? null,
          },
        });
        if (context.customerPhone) {
          await updateChatJourneyByExternalId({
            tenantId,
            externalId: context.customerPhone,
            patch: { type: 'lead', stage: 'qualified', leadId: lead?.id ?? null },
          }).catch(() => undefined);
        }

        return { success: true, data: { lead, stage: 'qualified' } };
      }

      case 'send_quote': {
        const quote = await lookupServiceQuote(tenantId, params);
        if (!quote) {
          return { success: false, error: 'Could not find a service to quote' };
        }

        const lead = await upsertLeadRecord({
          tenantId,
          phone: params.customer_phone ?? context.customerPhone ?? null,
          name: params.customer_name ?? null,
          intent: `quote:${quote.name}`,
          notes: params.quote_notes ?? `Quoted ${quote.name} for ₦${Math.round(quote.price).toLocaleString()}`,
          status: 'quoted',
          stage: 'proposal',
          source: 'ai_front_desk',
        });

        await recordFrontDeskEvent({
          tenantId,
          eventType: 'quote_sent',
          eventCategory: 'sales',
          channel: context.channel ?? 'whatsapp',
          actorRole: context.userRole ?? 'customer',
          customerId: context.customerId ?? null,
          serviceId: quote.id,
          messageId: context.messageId ?? null,
          correlationId: context.messageId ?? null,
          amount: quote.price,
          currency: 'NGN',
          metadata: {
            lead_id: lead?.id ?? null,
            service_name: quote.name,
            duration_minutes: quote.duration,
          },
        });
        if (context.customerPhone) {
          await updateChatJourneyByExternalId({
            tenantId,
            externalId: context.customerPhone,
            patch: { type: 'lead', stage: 'quoted', leadId: lead?.id ?? null },
          }).catch(() => undefined);
        }

        return { success: true, data: { quote, lead } };
      }

      case 'show_showcase': {
        if (!context.customerPhone) {
          return { success: false, error: 'Customer phone is required to send a showcase pack' };
        }

        const showcase = await sendShowcasePack(
          tenantId,
          context.customerPhone,
          typeof params.showcase_id === 'string' ? params.showcase_id : undefined,
          getShowcaseTriggerText(params)
        );

        if (showcase.success) {
          await recordFrontDeskEvent({
            tenantId,
            eventType: 'showcase_sent',
            eventCategory: 'sales',
            channel: context.channel ?? 'whatsapp',
            actorRole: context.userRole ?? 'customer',
            customerId: context.customerId ?? null,
            messageId: context.messageId ?? null,
            correlationId: context.messageId ?? null,
            metadata: {
              showcase_id: typeof params.showcase_id === 'string' ? params.showcase_id : showcase.pack?.id ?? null,
              trigger_text: getShowcaseTriggerText(params) ?? null,
              sent_count: showcase.sentCount,
            },
          });
        }

        return {
          success: showcase.success,
          data: showcase,
          error: showcase.success ? undefined : showcase.reason ?? 'Unable to send showcase pack',
        };
      }

      case 'show_catalog': {
        const products = await resolveCatalogProducts(tenantId, params);
        if (products.length === 0) {
          return { success: false, error: 'No matching active products found' };
        }

        const interactiveSent = context.customerPhone
          ? await sendCatalogInteractively(tenantId, context.customerPhone, products, params)
          : false;

        await recordFrontDeskEvent({
          tenantId,
          eventType: 'catalog_sent',
          eventCategory: 'sales',
          channel: context.channel ?? 'whatsapp',
          actorRole: context.userRole ?? 'customer',
          customerId: context.customerId ?? null,
          messageId: context.messageId ?? null,
          correlationId: context.messageId ?? null,
          metadata: {
            delivery: interactiveSent ? 'interactive' : 'text',
            product_ids: products.map((product) => product.id),
            query: params.query ?? null,
            category: params.category ?? null,
          },
        });
        if (context.customerPhone) {
          await updateChatJourneyByExternalId({
            tenantId,
            externalId: context.customerPhone,
            patch: { type: 'retail', stage: 'catalog_shared' },
          }).catch(() => undefined);
        }

        return {
          success: true,
          data: {
            delivery: interactiveSent ? 'interactive' : 'text',
            mode: 'catalog',
            products,
            title: typeof params.category === 'string'
              ? `${params.category} catalog`
              : (typeof params.query === 'string' ? `Catalog results for "${params.query}"` : 'Product catalog'),
          },
        };
      }

      case 'recommend_products': {
        const products = await resolveRecommendedProducts(tenantId, params, 'recommendation');
        if (products.length === 0) {
          return { success: false, error: 'No suitable product recommendations found' };
        }

        const interactiveSent = context.customerPhone
          ? await sendRecommendationsInteractively(tenantId, context.customerPhone, products)
          : false;

        await recordFrontDeskEvent({
          tenantId,
          eventType: 'recommendation_sent',
          eventCategory: 'sales',
          channel: context.channel ?? 'whatsapp',
          actorRole: context.userRole ?? 'customer',
          customerId: context.customerId ?? null,
          messageId: context.messageId ?? null,
          correlationId: context.messageId ?? null,
          metadata: {
            delivery: interactiveSent ? 'interactive' : 'text',
            product_ids: products.map((product) => product.id),
            reason: params.reason ?? null,
          },
        });
        if (context.customerPhone) {
          await updateChatJourneyByExternalId({
            tenantId,
            externalId: context.customerPhone,
            patch: { type: 'retail', stage: 'recommending' },
          }).catch(() => undefined);
        }

        return {
          success: true,
          data: {
            delivery: interactiveSent ? 'interactive' : 'text',
            mode: 'recommendations',
            products,
            title: typeof params.reason === 'string'
              ? `Recommended products for ${params.reason}`
              : 'Recommended products',
          },
        };
      }

      case 'offer_upsell':
      case 'offer_cross_sell': {
        const products = await resolveRecommendedProducts(
          tenantId,
          params,
          action === 'offer_upsell' ? 'upsell' : 'cross_sell',
        );
        if (products.length === 0) {
          return { success: false, error: 'No suitable products found for this offer' };
        }

        const interactiveSent = context.customerPhone
          ? await sendRecommendationsInteractively(tenantId, context.customerPhone, products)
          : false;

        await recordFrontDeskEvent({
          tenantId,
          eventType: action === 'offer_upsell' ? 'upsell_sent' : 'cross_sell_sent',
          eventCategory: 'sales',
          channel: context.channel ?? 'whatsapp',
          actorRole: context.userRole ?? 'customer',
          customerId: context.customerId ?? null,
          serviceId: params.service_id ?? null,
          messageId: context.messageId ?? null,
          correlationId: context.messageId ?? null,
          metadata: {
            delivery: interactiveSent ? 'interactive' : 'text',
            product_ids: products.map((product) => product.id),
            reason: params.reason ?? null,
          },
        });
        if (context.customerPhone) {
          await updateChatJourneyByExternalId({
            tenantId,
            externalId: context.customerPhone,
            patch: {
              type: 'retail',
              stage: action === 'offer_upsell' ? 'upsell_offered' : 'cross_sell_offered',
            },
          }).catch(() => undefined);
        }

        return {
          success: true,
          data: {
            delivery: interactiveSent ? 'interactive' : 'text',
            mode: action === 'offer_upsell' ? 'upsell' : 'cross_sell',
            products,
            title: action === 'offer_upsell' ? 'Recommended add-ons' : 'Recommended complementary products',
          },
        };
      }

      case 'create_retail_payment_link': {
        if (!context.customerPhone) {
          return { success: false, error: 'Customer phone is required to create a retail payment link' };
        }

        const paymentLink = await createRetailOrderPaymentLinkForCustomer({
          tenantId,
          externalId: context.customerPhone,
          channel: context.channel === 'instagram' ? 'instagram' : 'whatsapp',
          orderId: typeof params.order_id === 'string' ? params.order_id : null,
          actorUserId: context.messageId ?? 'frontdesk_ai',
          callbackUrl: typeof params.callback_url === 'string' ? params.callback_url : null,
        });

        await recordFrontDeskEvent({
          tenantId,
          eventType: 'payment_requested',
          eventCategory: 'payment',
          channel: context.channel ?? 'whatsapp',
          actorRole: 'system',
          customerId: context.customerId ?? null,
          messageId: context.messageId ?? null,
          correlationId: paymentLink.reference,
          amount: paymentLink.totalCents / 100,
          currency: 'NGN',
          metadata: {
            source: 'ai_front_desk',
            payment_url: paymentLink.paymentUrl,
            provider_reference: paymentLink.reference,
            order_id: paymentLink.orderId,
          },
        });
        await updateChatJourneyByExternalId({
          tenantId,
          externalId: context.customerPhone,
          patch: {
            type: 'retail',
            stage: 'pending_payment',
            orderId: paymentLink.orderId,
            orderTotalCents: paymentLink.totalCents,
          },
        }).catch(() => undefined);

        return { success: true, data: paymentLink };
      }

      case 'recover_lead': {
        const lead = await upsertLeadRecord({
          tenantId,
          phone: params.customer_phone ?? context.customerPhone ?? null,
          name: params.customer_name ?? null,
          intent: params.intent ?? 'lead_recovery',
          notes: params.reason ?? 'Lead recovery scheduled by AI front desk',
          status: 'recovery_scheduled',
          stage: 'followup',
          source: 'ai_front_desk',
          followUpAt: typeof params.follow_up_at === 'string'
            ? params.follow_up_at
            : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });

        const campaignRunId = await scheduleLeadRecoveryCampaign({
          tenantId,
          phone: params.customer_phone ?? context.customerPhone ?? null,
          customerId: context.customerId ?? null,
          leadId: lead?.id ?? null,
          message: params.recovery_message ?? params.offer_text ?? null,
          reason: params.reason ?? 'lead_recovery',
          scheduledFor: typeof params.follow_up_at === 'string' ? params.follow_up_at : null,
        });

        await recordFrontDeskEvent({
          tenantId,
          eventType: 'follow_up_scheduled',
          eventCategory: 'retention',
          channel: context.channel ?? 'whatsapp',
          actorRole: context.userRole ?? 'customer',
          customerId: context.customerId ?? null,
          campaignRunId,
          messageId: context.messageId ?? null,
          correlationId: context.messageId ?? null,
          metadata: {
            lead_id: lead?.id ?? null,
            follow_up_at: params.follow_up_at ?? null,
            reason: params.reason ?? null,
            recovery_message: params.recovery_message ?? null,
          },
        });
        if (context.customerPhone) {
          await updateChatJourneyByExternalId({
            tenantId,
            externalId: context.customerPhone,
            patch: { type: 'lead', stage: 'followup_scheduled', leadId: lead?.id ?? null },
          }).catch(() => undefined);
        }

        return { success: true, data: { lead, campaignRunId } };
      }

      case 'add_service': {
        const { error } = await supabaseAdmin
          .from('services')
          .insert({
            tenant_id: tenantId,
            name: params.name,
            price: params.price ?? 0,
            duration: params.duration_minutes ?? 60,
            is_active: true,
            aliases: params.aliases ?? [],
          });
        return { success: !error, error: error?.message };
      }

      case 'update_service': {
        const updates: Record<string, unknown> = {};
        if (params.name !== undefined) updates.name = params.name;
        if (params.price !== undefined) updates.price = params.price;
        if (params.duration_minutes !== undefined) updates.duration = params.duration_minutes;
        if (params.aliases !== undefined) updates.aliases = params.aliases;
        const { error } = await supabaseAdmin
          .from('services')
          .update(updates)
          .eq('id', params.service_id)
          .eq('tenant_id', tenantId);
        return { success: !error, error: error?.message };
      }

      case 'add_staff': {
        const { error } = await supabaseAdmin
          .from('tenant_users')
          .insert({
            tenant_id: tenantId,
            role: 'staff',
            phone: params.phone ?? null,
            services_all: params.services_all ?? true,
          });
        return { success: !error, error: error?.message };
      }

      case 'update_schedule': {
        const { error } = await supabaseAdmin
          .from('schedule_overrides')
          .upsert({
            tenant_id: tenantId,
            tenant_staff_id: params.tenant_staff_id,
            date: params.date,
            is_blocked: params.is_blocked ?? false,
            custom_start: params.custom_start ?? null,
            custom_end: params.custom_end ?? null,
            reason: params.reason ?? null,
          }, { onConflict: 'tenant_staff_id,date' });
        return { success: !error, error: error?.message };
      }

      case 'walk_in': {
        const staffId = params.resolved_staff_id ?? params.tenant_staff_id ?? params.staff_id;
        const serviceId = params.resolved_service_id ?? params.service_id;
        const startAt = params.walk_in_start_at ?? new Date().toISOString();
        const endAt = params.walk_in_end_at ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const reservation = await createReservation(supabaseAdmin, {
          tenant_id: tenantId,
          customer_id: params.customer_id ?? context.customerId ?? null,
          customer_name: params.customer_name ?? 'Walk-in',
          phone: params.customer_phone ?? context.customerPhone ?? null,
          service_id: serviceId ?? null,
          service: params.service_name ?? serviceId ?? null,
          start_at: startAt,
          end_at: endAt,
          status: 'confirmed',
          metadata: {
            source: 'whatsapp_v2_ai',
            action: 'walk_in',
          },
          staff_id: staffId ?? null,
        });
        return { success: true, data: { reservation } };
      }

      default:
        return { success: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[actionValidator] executeAction error', { action, tenantId, error: message });
    return { success: false, error: message };
  }
}

type ProductSelection = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price_cents: number | null;
  currency: string | null;
  is_featured: boolean;
  stock_quantity: number | null;
  track_inventory: boolean;
};

function getShowcaseTriggerText(params: Record<string, unknown>): string | undefined {
  const candidates = [
    params.trigger_text,
    params.showcase_name,
    params.query,
    params.category,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

async function loadActiveProducts(tenantId: string): Promise<ProductSelection[]> {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('id, name, description, short_description, category, price_cents, currency, is_featured, stock_quantity, track_inventory')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('is_featured', { ascending: false })
    .order('name', { ascending: true })
    .limit(24);

  if (error || !Array.isArray(data)) {
    return [];
  }

  return data
    .map((row) => normalizeProductSelection(row as Record<string, unknown>))
    .filter((row): row is ProductSelection => row !== null);
}

function toCatalogProduct(product: ProductSelection): Product {
  return {
    id: product.id,
    tenant_id: '',
    name: product.name,
    description: product.description ?? undefined,
    short_description: product.description ?? undefined,
    price_cents: product.price_cents ?? 0,
    currency: product.currency ?? 'NGN',
    category: product.category ?? undefined,
    is_active: true,
    is_featured: product.is_featured,
    track_inventory: product.track_inventory,
    stock_quantity: product.stock_quantity ?? undefined,
    low_stock_threshold: 0,
  };
}

async function sendCatalogInteractively(
  tenantId: string,
  customerPhone: string,
  products: ProductSelection[],
  params: Record<string, unknown>
): Promise<boolean> {
  const client = await getTenantWhatsAppProviderClient(tenantId);
  if (!client) return false;

  const mapped = products.map(toCatalogProduct);
  if (mapped.length === 1) {
    if (mapped[0]?.images?.[0]) {
      await client.sendMediaMessage(customerPhone, {
        url: mapped[0].images[0],
        mimetype: 'image/jpeg',
      }, `✨ ${mapped[0].name}`, 'image');
    }
    const result = await client.sendInteractiveMessage(customerPhone, buildProductDetailsMessage(mapped[0], true));
    return result.success;
  }

  const categoryName = typeof params.category === 'string' ? params.category : undefined;
  const chunk = mapped.slice(0, 10);
  const result = await client.sendInteractiveMessage(
    customerPhone,
    buildProductListMessage(chunk, categoryName),
  );
  return result.success;
}

async function sendRecommendationsInteractively(
  tenantId: string,
  customerPhone: string,
  products: ProductSelection[],
): Promise<boolean> {
  const client = await getTenantWhatsAppProviderClient(tenantId);
  if (!client) return false;
  const result = await client.sendInteractiveMessage(
    customerPhone,
    buildRecommendationsMessage(products.map(toCatalogProduct)),
  );
  return result.success;
}

function normalizeProductSelection(row: Record<string, unknown>): ProductSelection | null {
  if (!row.id || !row.name) return null;

  return {
    id: String(row.id),
    name: String(row.name),
    description: typeof row.short_description === 'string'
      ? row.short_description
      : (typeof row.description === 'string' ? row.description : null),
    category: typeof row.category === 'string' ? row.category : null,
    price_cents: typeof row.price_cents === 'number' ? row.price_cents : Number(row.price_cents ?? 0),
    currency: typeof row.currency === 'string' ? row.currency : null,
    is_featured: Boolean(row.is_featured),
    stock_quantity: typeof row.stock_quantity === 'number' ? row.stock_quantity : Number(row.stock_quantity ?? 0),
    track_inventory: typeof row.track_inventory === 'boolean' ? row.track_inventory : Boolean(row.track_inventory),
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function matchesSearchTerm(product: ProductSelection, term: string): boolean {
  if (!term) return true;

  return [
    product.name,
    product.description,
    product.category,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .some((value) => value.toLowerCase().includes(term));
}

function parseIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

async function resolveCatalogProducts(
  tenantId: string,
  params: Record<string, unknown>
): Promise<ProductSelection[]> {
  const rows = await loadActiveProducts(tenantId);
  if (rows.length === 0) return [];

  const productIds = parseIdList(params.product_ids);
  if (productIds.length > 0) {
    const selected = rows.filter((row) => productIds.includes(row.id));
    if (selected.length > 0) return selected.slice(0, 6);
  }

  const query = normalizeText(params.query ?? params.product_name ?? params.category);
  if (query) {
    const matched = rows.filter((row) => matchesSearchTerm(row, query));
    if (matched.length > 0) return matched.slice(0, 6);
  }

  return rows.slice(0, 6);
}

async function resolveRecommendedProducts(
  tenantId: string,
  params: Record<string, unknown>,
  mode: 'recommendation' | 'upsell' | 'cross_sell' = 'recommendation',
): Promise<ProductSelection[]> {
  const rows = await loadActiveProducts(tenantId);
  if (rows.length === 0) return [];

  const productIds = parseIdList(params.product_ids);
  const query = normalizeText(params.query ?? params.product_name ?? params.reason);
  const anchors = productIds.length > 0
    ? rows.filter((row) => productIds.includes(row.id))
    : (query ? rows.filter((row) => matchesSearchTerm(row, query)) : []);

  const anchorIds = new Set(anchors.map((row) => row.id));
  const preferredCategories = new Set(
    anchors
      .map((row) => row.category)
      .filter((category): category is string => typeof category === 'string' && category.length > 0)
  );

  const recommendations = rows.filter((row) => {
    if (anchorIds.has(row.id)) return false;
    if (preferredCategories.size === 0) {
      return mode === 'cross_sell' ? !row.is_featured : row.is_featured;
    }
    if (!row.category) return false;
    if (mode === 'cross_sell') {
      return !preferredCategories.has(row.category);
    }
    return preferredCategories.has(row.category);
  });

  const ranked = recommendations.sort((a, b) => {
    if (a.is_featured !== b.is_featured) return Number(b.is_featured) - Number(a.is_featured);
    return (b.price_cents ?? 0) - (a.price_cents ?? 0);
  });

  if (ranked.length > 0) {
    return ranked.slice(0, 5);
  }

  return rows
    .filter((row) => !anchorIds.has(row.id))
    .slice(0, 5);
}
