import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Human-handoff for the v2 customer pipeline.
 *
 * Note: the pipeline's `escalate` AI action only re-routes to a stronger model
 * (L3). This module handles an EXPLICIT customer request to reach a person —
 * detecting intent and creating an `escalation_queue` ticket for staff. The
 * insert mirrors sias-operations.createEscalationTicket (incl. 2-hour dedup).
 */

const HUMAN_PATTERNS: RegExp[] = [
  /\bagent\b/,
  /\bhuman\b/,
  /\brepresentative\b/,
  /(speak|talk|chat)\s+(to|with)\s+(a\s+)?(person|someone|human|agent|staff|representative)/,
  /real\s+person/,
];

/** True when the customer is explicitly asking to reach a human. */
export function wantsHuman(text: string): boolean {
  const t = (text ?? '').toLowerCase();
  return HUMAN_PATTERNS.some((re) => re.test(t));
}

export interface HumanHandoffInput {
  tenantId: string;
  customerPhone: string;
  sessionId: string;
  reason?: string;
  conversationSnapshot?: unknown[];
}

/**
 * Create a pending escalation ticket, de-duplicated against any open ticket for
 * the same tenant+phone+reason in the last 2 hours. Returns the existing or new
 * row, or null on insert error (non-throwing — handoff must not break the reply).
 */
export async function createHumanHandoff(
  admin: SupabaseClient,
  input: HumanHandoffInput,
): Promise<{ id: string } | null> {
  const reason = (input.reason ?? 'customer requested human').trim() || 'customer requested human';
  const duplicateWindow = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: existing } = await admin
    .from('escalation_queue')
    .select('id, status')
    .eq('tenant_id', input.tenantId)
    .eq('customer_phone', input.customerPhone)
    .eq('reason', reason)
    .gte('created_at', duplicateWindow)
    .in('status', ['pending', 'claimed'])
    .limit(1)
    .maybeSingle();

  if (existing) return existing as { id: string };

  const { data } = await admin
    .from('escalation_queue')
    .insert({
      tenant_id: input.tenantId,
      customer_phone: input.customerPhone,
      session_id: input.sessionId,
      reason,
      status: 'pending',
      conversation_snapshot: input.conversationSnapshot ?? [],
    })
    .select('id')
    .maybeSingle();

  return (data as { id: string } | null) ?? null;
}
