/**
 * Booking Action Validator
 *
 * Channel-agnostic validation and execution layer for AI-proposed booking actions.
 * WhatsApp v2 currently consumes this module first; legacy path re-exports remain
 * in place until the rest of the channel surface is fully migrated.
 */

import { createClient } from '@supabase/supabase-js';
import { cancelReservation, createReservation, rescheduleReservation } from '@/lib/reservationService';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type AIAction =
  | 'create_booking'
  | 'get_availability'
  | 'list_services'
  | 'list_staff'
  | 'get_price'
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
  | 'general_reply'
  | 'needs_info'
  | 'escalate';

export interface AIResponse {
  action: AIAction;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: Record<string, any>;
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

  switch (action) {
    case 'create_booking':
      return validateCreateBooking(tenantId, params);

    case 'cancel_booking':
    case 'reschedule_booking':
    case 'mark_no_show':
      return validateReservationOwnership(tenantId, params.reservation_id);

    case 'update_service':
      return validateServiceOwnership(tenantId, params.service_id);

    case 'add_service':
      return params.name && params.price !== undefined
        ? { valid: true }
        : { valid: false, error: 'add_service requires name and price', retryContext: 'The service must have a name and a price.' };

    case 'add_staff':
      return params.name
        ? { valid: true }
        : { valid: false, error: 'add_staff requires name', retryContext: 'The staff member must have a name.' };

    case 'update_schedule':
    case 'block_slot':
      return params.tenant_staff_id || params.staff_name
        ? { valid: true }
        : { valid: false, error: 'update_schedule requires staff identifier', retryContext: 'Please specify which staff member to update.' };

    case 'walk_in':
      return validateWalkIn(tenantId, params);

    case 'get_availability':
    case 'list_services':
    case 'list_staff':
    case 'get_price':
    case 'get_insights':
    case 'owner_query':
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: Record<string, any>
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: Record<string, any>
): Promise<ValidationResult> {
  let staffId: string | undefined = params.tenant_staff_id ?? params.staff_id;

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

  let serviceId: string | undefined = params.service_id;
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

export async function executeAction(
  tenantId: string,
  aiResponse: AIResponse,
  context: { customerPhone?: string; tenantStaffId?: string; customerId?: string }
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const { action, params } = aiResponse;

  try {
    switch (action) {
      case 'create_booking': {
        const startAt = params.start_at;
        const endAt = params.end_at ?? new Date(new Date(startAt).getTime() + 60 * 60 * 1000).toISOString();
        const reservation = await createReservation(supabaseAdmin as any, {
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
        return { success: true, data: { reservation } };
      }

      case 'cancel_booking': {
        const reservation = await cancelReservation(supabaseAdmin as any, {
          tenant_id: tenantId,
          reservation_id: params.reservation_id,
          reason: params.reason ?? null,
        });
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
        }
        return { success: !error, error: error?.message };
      }

      case 'reschedule_booking': {
        const reservation = await rescheduleReservation(supabaseAdmin as any, {
          tenant_id: tenantId,
          reservation_id: params.reservation_id,
          start_at: params.new_start_at,
          end_at: params.new_end_at,
          staff_id: params.staff_id ?? params.tenant_staff_id ?? null,
          reason: params.reason ?? null,
        });
        return { success: !!reservation, data: reservation, error: reservation ? undefined : 'Reservation not found' };
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
        const reservation = await createReservation(supabaseAdmin as any, {
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
