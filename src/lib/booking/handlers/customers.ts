import type { SupabaseClient } from '@supabase/supabase-js';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';
import type { ActionHandler } from './registry';

type ActionContext = { actorId?: string | null };

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

async function lapsedCustomersQueryExecute(admin: SupabaseClient, tenantId: string, params: Record<string, unknown>) {
  const threshold = Math.max(1, toInteger(params.days) ?? 45);
  const { data, error } = await admin
    .from('followup_candidates_view')
    .select('customer_id, customer_name, customer_phone, days_since_visit, candidate_reason, risk_score')
    .eq('tenant_id', tenantId)
    .eq('is_followup_candidate', true);

  if (error) return { success: false, error: error.message };

  const rows = (data ?? [])
    .filter((row) => Number(row.days_since_visit ?? 0) >= threshold)
    .map((row) => ({
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      customer_phone: row.customer_phone,
      days_since_visit: row.days_since_visit,
      candidate_reason: row.candidate_reason,
      risk_score: row.risk_score,
    }));

  const reply = rows.length
    ? `Lapsed customers:\n${rows.map((row) => `• ${row.customer_name}: ${row.days_since_visit} days (${row.risk_score})`).join('\n')}`
    : 'No lapsed customers in that range.';

  return { success: true, reply, data: { items: rows } };
}

async function addCustomerNoteExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: ActionContext
) {
  const customerId = getString(params.customer_id);
  const note = getString(params.note);
  if (!customerId || !note) {
    return { success: false, error: 'add_customer_note requires customer_id and note' };
  }

  const { data: customer, error: fetchError } = await admin
    .from('customers')
    .select('id, notes, name, customer_name')
    .eq('tenant_id', tenantId)
    .eq('id', customerId)
    .maybeSingle();

  if (fetchError || !customer) {
    return { success: false, error: fetchError?.message ?? 'Customer not found' };
  }

  const previous = getString(customer.notes) ?? '';
  const nextNotes = previous
    ? `${previous}\n[${new Date().toISOString()}] ${note}`
    : `[${new Date().toISOString()}] ${note}`;

  const { data: updated, error } = await admin
    .from('customers')
    .update({ notes: nextNotes })
    .eq('tenant_id', tenantId)
    .eq('id', customerId)
    .select('id, notes, name, customer_name')
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message ?? 'Failed to update customer note' };
  }

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    action: BUSINESS_EVENT_ACTIONS.CUSTOMER_NOTE_ADDED,
    entityType: 'customer',
    entityId: customerId,
    source: 'whatsapp',
    before: { notes: customer.notes ?? null },
    after: { notes: updated.notes ?? null },
    metadata: { note },
  });

  return {
    success: true,
    reply: `Added note for ${updated.name ?? updated.customer_name ?? 'customer'}.`,
    data: { customer: updated },
  };
}

async function customerHistoryExecute(admin: SupabaseClient, tenantId: string, params: Record<string, unknown>) {
  const customerId = getString(params.customer_id);
  if (!customerId) {
    return { success: false, error: 'customer_history requires customer_id' };
  }

  const { data, error } = await admin
    .from('customer_service_history_view')
    .select('service_name, booking_count, completed_count, cancelled_count, last_completed_at')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId);

  if (error) return { success: false, error: error.message };

  const rows = (data ?? []).map((row) => ({
    service_name: row.service_name,
    booking_count: row.booking_count,
    completed_count: row.completed_count,
    cancelled_count: row.cancelled_count,
    last_completed_at: row.last_completed_at,
  }));

  const reply = rows.length
    ? `Customer history:\n${rows.map((row) => `• ${row.service_name}: ${row.completed_count}/${row.booking_count} completed`).join('\n')}`
    : 'No recorded customer history yet.';

  return { success: true, reply, data: { items: rows } };
}

async function setCustomerTagExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: ActionContext
) {
  const customerId = getString(params.customer_id);
  const tag = getString(params.tag);
  if (!customerId || !tag) {
    return { success: false, error: 'set_customer_tag requires customer_id and tag' };
  }

  const { data: customer, error: fetchError } = await admin
    .from('customers')
    .select('id, tags')
    .eq('tenant_id', tenantId)
    .eq('id', customerId)
    .maybeSingle();

  if (fetchError || !customer) {
    return { success: false, error: fetchError?.message ?? 'Customer not found' };
  }

  const previousTags = Array.isArray(customer.tags) ? customer.tags.filter((value): value is string => typeof value === 'string') : [];
  const nextTags = previousTags.includes(tag) ? previousTags : [...previousTags, tag];

  const { data: updated, error } = await admin
    .from('customers')
    .update({ tags: nextTags })
    .eq('tenant_id', tenantId)
    .eq('id', customerId)
    .select('id, tags')
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message ?? 'Failed to update customer tags' };
  }

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    action: BUSINESS_EVENT_ACTIONS.CUSTOMER_TAGGED,
    entityType: 'customer',
    entityId: customerId,
    source: 'whatsapp',
    before: { tags: previousTags },
    after: { tags: updated.tags ?? [] },
    metadata: { tag },
  });

  return {
    success: true,
    reply: `Tagged customer with ${tag}.`,
    data: { customer: updated },
  };
}

export const customerHandlers: Record<string, ActionHandler> = {
  lapsed_customers_query: {
    action: 'lapsed_customers_query',
    requiresConfirmation: false,
    async validate() {
      return { valid: true };
    },
    execute: lapsedCustomersQueryExecute,
  },
  add_customer_note: {
    action: 'add_customer_note',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      return getString(params.customer_id) && getString(params.note)
        ? { valid: true }
        : { valid: false, error: 'add_customer_note requires customer_id and note' };
    },
    execute: addCustomerNoteExecute,
  },
  customer_history: {
    action: 'customer_history',
    requiresConfirmation: false,
    async validate(_admin, _tenantId, params) {
      return getString(params.customer_id)
        ? { valid: true }
        : { valid: false, error: 'customer_history requires customer_id' };
    },
    execute: customerHistoryExecute,
  },
  set_customer_tag: {
    action: 'set_customer_tag',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      return getString(params.customer_id) && getString(params.tag)
        ? { valid: true }
        : { valid: false, error: 'set_customer_tag requires customer_id and tag' };
    },
    execute: setCustomerTagExecute,
  },
};
