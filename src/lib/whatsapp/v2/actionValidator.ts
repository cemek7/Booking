/**
 * Action Validator
 *
 * Receives the {action, params} object returned by L2/L3 AI and validates it
 * before any database writes are committed.
 *
 * Validation responsibilities:
 *  - create_booking: delegates to existing BookingEngine.createBooking()
 *                    + checks slot_locks for current holds
 *  - cancel_booking: verifies reservation exists + belongs to this tenant
 *  - reschedule_booking: same ownership check
 *  - mark_no_show: same
 *  - update_service: verifies service belongs to tenant
 *  - add_staff / update_schedule / block_slot / add_service: basic FK checks
 *  - owner_query / get_insights / list_*: read-only, always valid
 *  - general_reply / needs_info: no-op validation, always valid
 *
 * On failure returns { valid: false, error, retryContext } so the pipeline
 * can feed the error back to the AI for a retry (max 2 attempts).
 */

import { createClient } from '@supabase/supabase-js';
import { bookingEngine } from '@/lib/booking/engine';

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
  retryContext?: string; // included in the retry prompt to the AI
}

// ─── Main validator ───────────────────────────────────────────────────────────

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

    // Read-only or message-only actions — always valid
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function validateCreateBooking(
  tenantId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: Record<string, any>
): Promise<ValidationResult> {
  // Check required fields
  const required = ['service_id', 'start_at'];
  for (const field of required) {
    if (!params[field]) {
      return {
        valid: false,
        error: `create_booking missing required field: ${field}`,
        retryContext: `A booking requires at least a service and a start time.`,
      };
    }
  }

  // Check if the slot is already locked by another customer
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
  // Resolve staff ID
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

  // Resolve service duration
  let serviceId: string | undefined = params.service_id;
  let durationMinutes = 60;

  if (!serviceId && params.service_name) {
    const { data: svc } = await supabaseAdmin
      .from('services')
      .select('id, duration_minutes')
      .eq('tenant_id', tenantId)
      .ilike('name', `%${params.service_name}%`)
      .maybeSingle();
    serviceId = svc?.id;
    durationMinutes = svc?.duration_minutes ?? 60;
  } else if (serviceId) {
    const { data: svc } = await supabaseAdmin
      .from('services')
      .select('duration_minutes')
      .eq('id', serviceId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    durationMinutes = svc?.duration_minutes ?? 60;
  }

  // Check for current-time conflict in reservations
  const now = new Date();
  const walkInEnd = new Date(now.getTime() + durationMinutes * 60 * 1000);

  const { data: conflict } = await supabaseAdmin
    .from('reservations')
    .select('start_at, end_at, customer_name')
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
    const customerName = (conflict.customer_name as string) ?? 'another customer';
    return {
      valid: false,
      error: `Staff has an active booking until ${conflictEnd}`,
      retryContext: `That staff member is currently booked with ${customerName} until ${conflictEnd}. The walk-in will need to wait or be assigned to another available staff member.`,
    };
  }

  // Store resolved values in params for executeAction to use
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

// ─── Action executor ──────────────────────────────────────────────────────────

/**
 * Commits a validated action to the database.
 * Only called after validateAction() returns { valid: true }.
 */
export async function executeAction(
  tenantId: string,
  aiResponse: AIResponse,
  context: { customerPhone?: string; tenantStaffId?: string; customerId?: string }
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const { action, params } = aiResponse;

  try {
    switch (action) {
      case 'create_booking': {
        const bookingInput = {
          service_id: params.service_id,
          staff_id: params.staff_id,
          start_at: params.start_at,
          customer_name: params.customer_name,
          customer_phone: context.customerPhone ?? '',
          notes: params.notes,
        } as unknown as Parameters<typeof bookingEngine.createBooking>[1];
        const result = await bookingEngine.createBooking(tenantId, bookingInput, { skipPayment: true, sendConfirmation: false });
        return { success: true, data: result };
      }

      case 'cancel_booking': {
        const { error } = await supabaseAdmin
          .from('reservations')
          .update({ status: 'cancelled' })
          .eq('id', params.reservation_id)
          .eq('tenant_id', tenantId);
        return { success: !error, error: error?.message };
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
        const { error } = await supabaseAdmin
          .from('reservations')
          .update({ start_at: params.new_start_at, end_at: params.new_end_at })
          .eq('id', params.reservation_id)
          .eq('tenant_id', tenantId);
        return { success: !error, error: error?.message };
      }

      case 'add_service': {
        const { error } = await supabaseAdmin
          .from('services')
          .insert({
            tenant_id: tenantId,
            name: params.name,
            price_cents: Math.round((params.price ?? 0) * 100),
            duration_minutes: params.duration_minutes ?? 60,
            is_active: true,
            aliases: params.aliases ?? [],
          });
        return { success: !error, error: error?.message };
      }

      case 'update_service': {
        const updates: Record<string, unknown> = {};
        if (params.name !== undefined) updates.name = params.name;
        if (params.price !== undefined) updates.price_cents = Math.round(params.price * 100);
        if (params.duration_minutes !== undefined) updates.duration_minutes = params.duration_minutes;
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
        const { error } = await supabaseAdmin
          .from('reservations')
          .insert({
            tenant_id: tenantId,
            tenant_staff_id: staffId,
            service_id: serviceId ?? null,
            start_at: startAt,
            end_at: endAt,
            status: 'confirmed',
            customer_name: params.customer_name ?? 'Walk-in',
            customer_phone: params.customer_phone ?? context.customerPhone ?? null,
            notes: params.notes ?? 'Walk-in customer',
          });
        return { success: !error, error: error?.message };
      }

      // Read-only and message actions don't write to DB
      default:
        return { success: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[actionValidator] executeAction error', { action, tenantId, error: message });
    return { success: false, error: message };
  }
}
