import type { SupabaseClient } from '@supabase/supabase-js';
import { recordBusinessEvent } from '@/lib/audit/businessEvents';
import { executeAction, validateAction, type AIResponse } from '@/lib/booking/action-validator';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { resolveLimit, type ApprovalRequestType, type ApprovalRole } from './policy';

export interface CreateApprovalRequestInput {
  tenantId: string;
  requestType: ApprovalRequestType;
  requestedBy: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  amount?: number | null;
  percent?: number | null;
  reason?: string | null;
  actionPayload: AIResponse;
  requiredPermission: string;
  expiresAt?: string | null;
}

export interface DecideApprovalInput {
  requestId: string;
  actorId: string;
  actorPerms: Iterable<string>;
  decision: 'approve' | 'reject';
  note?: string | null;
}

type ApprovalRequestRow = {
  id: string;
  tenant_id: string;
  request_type: ApprovalRequestType;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  requested_by?: string | null;
  reason?: string | null;
  action_payload: AIResponse;
  required_permission: string;
  expires_at?: string | null;
};

type ApprovalPolicyTableRow = {
  request_type: ApprovalRequestType;
  role: string;
  max_self_approve: number | string;
  requires_permission: string;
};

export interface ApprovalGateInput {
  tenantId: string;
  actorId: string;
  actorRole: ApprovalRole;
  aiResponse: AIResponse;
}

export interface ApprovalGateResult {
  status: 'clear' | 'pending';
  requestId?: string;
  reply?: string;
}

function toInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseDiscountPercent(aiResponse: AIResponse): number | null {
  if (aiResponse.action !== 'create_order') return null;
  const discountPercent = toInteger(aiResponse.params.discount_percent);
  if (discountPercent !== null) return discountPercent;

  const discountCents = Math.max(0, toInteger(aiResponse.params.discount_cents ?? aiResponse.params.discount) ?? 0);
  const items = Array.isArray(aiResponse.params.items) ? aiResponse.params.items : [];
  const subtotalCents = items.reduce((sum, item) => {
    if (!item || typeof item !== 'object') return sum;
    const record = item as Record<string, unknown>;
    const quantity = Math.max(0, toInteger(record.quantity) ?? 0);
    const total = toInteger(record.total_price_cents) ?? ((toInteger(record.unit_price_cents ?? record.price_cents ?? record.price) ?? 0) * quantity);
    return sum + Math.max(0, total);
  }, 0);

  if (subtotalCents <= 0 || discountCents <= 0) return null;
  return (discountCents / subtotalCents) * 100;
}

function classifyApprovalRequest(aiResponse: AIResponse): {
  requestType: ApprovalRequestType;
  amount?: number | null;
  percent?: number | null;
  subjectType?: string | null;
  subjectId?: string | null;
  reason?: string | null;
} | null {
  if (aiResponse.action === 'refund_sale') {
    return {
      requestType: 'refund',
      amount: null,
      percent: null,
      subjectType: 'retail_order',
      subjectId: getString(aiResponse.params.order_id),
      reason: getString(aiResponse.params.reason),
    };
  }

  if (aiResponse.action === 'adjust_stock') {
    return {
      requestType: 'stock_adjustment',
      amount: Math.abs(toInteger(aiResponse.params.delta) ?? 0),
      percent: null,
      subjectType: getString(aiResponse.params.variant_id) ? 'product_variant' : 'product',
      subjectId: getString(aiResponse.params.variant_id) ?? getString(aiResponse.params.product_id),
      reason: getString(aiResponse.params.reason),
    };
  }

  const discountPercent = parseDiscountPercent(aiResponse);
  if (discountPercent != null && discountPercent > 0) {
    return {
      requestType: 'discount',
      amount: Math.max(0, toInteger(aiResponse.params.discount_cents ?? aiResponse.params.discount) ?? 0),
      percent: discountPercent,
      subjectType: 'retail_order',
      subjectId: getString(aiResponse.params.order_id),
      reason: getString(aiResponse.params.reason),
    };
  }

  return null;
}

function toPermissionSet(actorPerms: Iterable<string>) {
  return actorPerms instanceof Set ? actorPerms : new Set(actorPerms);
}

export async function createApprovalRequest(
  admin: SupabaseClient,
  input: CreateApprovalRequestInput
) {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from('approval_requests')
    .insert({
      tenant_id: input.tenantId,
      request_type: input.requestType,
      requested_by: input.requestedBy,
      subject_type: input.subjectType ?? null,
      subject_id: input.subjectId ?? null,
      amount: input.amount ?? null,
      percent: input.percent ?? null,
      reason: input.reason ?? null,
      action_payload: input.actionPayload,
      required_permission: input.requiredPermission,
      expires_at: input.expiresAt ?? null,
      updated_at: nowIso,
    })
    .select('*')
    .single<ApprovalRequestRow>();

  if (error || !data) {
    throw error ?? new Error('Failed to create approval request');
  }

  await recordBusinessEvent(admin, {
    tenantId: input.tenantId,
    actorType: 'user',
    actorId: input.requestedBy,
    action: 'approval.requested',
    entityType: 'approval_request',
    entityId: data.id,
    source: 'system',
    reason: input.reason ?? null,
    metadata: {
      request_type: input.requestType,
      required_permission: input.requiredPermission,
      subject_type: input.subjectType ?? null,
      subject_id: input.subjectId ?? null,
    },
  });

  return data;
}

export async function decideApproval(
  admin: SupabaseClient,
  input: DecideApprovalInput
) {
  const { data: request, error } = await admin
    .from('approval_requests')
    .select('*')
    .eq('id', input.requestId)
    .maybeSingle<ApprovalRequestRow>();

  if (error) throw error;
  if (!request) throw ApiErrorFactory.notFound('Approval request');

  if (request.status !== 'pending') {
    return request;
  }

  if (request.requested_by && request.requested_by === input.actorId) {
    throw ApiErrorFactory.forbidden('Approver cannot approve their own request');
  }

  const actorPerms = toPermissionSet(input.actorPerms);
  if (!actorPerms.has('*') && !actorPerms.has(request.required_permission)) {
    throw ApiErrorFactory.forbidden('Approver lacks required permission');
  }

  if (request.expires_at && new Date(request.expires_at).getTime() <= Date.now()) {
    throw ApiErrorFactory.validationError('Approval request has expired');
  }

  const nowIso = new Date().toISOString();

  if (input.decision === 'reject') {
    const { data: rejected, error: rejectError } = await admin
      .from('approval_requests')
      .update({ status: 'rejected', updated_at: nowIso })
      .eq('id', request.id)
      .eq('status', 'pending')
      .select('*')
      .single<ApprovalRequestRow>();

    if (rejectError || !rejected) throw rejectError ?? new Error('Failed to reject approval request');

    const { error: actionError } = await admin.from('approval_actions').insert({
      tenant_id: request.tenant_id,
      request_id: request.id,
      actor_id: input.actorId,
      decision: 'reject',
      note: input.note ?? null,
    });
    if (actionError) throw actionError;

    await recordBusinessEvent(admin, {
      tenantId: request.tenant_id,
      actorType: 'user',
      actorId: input.actorId,
      action: 'approval.rejected',
      entityType: 'approval_request',
      entityId: request.id,
      source: 'system',
      reason: input.note ?? null,
      metadata: {
        request_type: request.request_type,
        required_permission: request.required_permission,
      },
    });

    return rejected;
  }

  const validation = await validateAction(request.tenant_id, request.action_payload);
  if (!validation.valid) {
    throw ApiErrorFactory.validationError(validation.error ?? 'Approval payload no longer validates');
  }

  const execution = await executeAction(request.tenant_id, request.action_payload, {
    actorId: input.actorId,
    userRole: 'owner',
    channel: 'dashboard',
  });
  if (!execution.success) {
    throw ApiErrorFactory.validationError(execution.error ?? 'Approved action failed to execute');
  }

  const { data: approved, error: approveError } = await admin
    .from('approval_requests')
    .update({ status: 'approved', updated_at: nowIso })
    .eq('id', request.id)
    .eq('status', 'pending')
    .select('*')
    .single<ApprovalRequestRow>();

  if (approveError || !approved) throw approveError ?? new Error('Failed to approve request');

  const { error: actionError } = await admin.from('approval_actions').insert({
    tenant_id: request.tenant_id,
    request_id: request.id,
    actor_id: input.actorId,
    decision: 'approve',
    note: input.note ?? null,
  });
  if (actionError) throw actionError;

  await recordBusinessEvent(admin, {
    tenantId: request.tenant_id,
    actorType: 'user',
    actorId: input.actorId,
    action: 'approval.approved',
    entityType: 'approval_request',
    entityId: request.id,
    source: 'system',
    reason: input.note ?? null,
    metadata: {
      request_type: request.request_type,
      required_permission: request.required_permission,
    },
  });

  return approved;
}

export async function gateApprovalForAction(
  admin: SupabaseClient,
  input: ApprovalGateInput
): Promise<ApprovalGateResult> {
  const classified = classifyApprovalRequest(input.aiResponse);
  if (!classified) return { status: 'clear' };

  if (classified.requestType === 'refund' && !classified.reason) {
    throw ApiErrorFactory.validationError('Refunds require a reason before they can be submitted');
  }

  const { data: policyRows, error } = await admin
    .from('tenant_approval_policies')
    .select('request_type, role, max_self_approve, requires_permission')
    .eq('tenant_id', input.tenantId);
  if (error) throw error;

  const resolved = resolveLimit(
    input.actorRole,
    classified.requestType,
    (policyRows ?? []) as ApprovalPolicyTableRow[]
  );

  const metric =
    classified.requestType === 'discount'
      ? classified.percent ?? 0
      : classified.amount ?? 0;

  const exceedsLimit = Number.isFinite(resolved.maxSelfApprove) && metric > resolved.maxSelfApprove;
  if (!exceedsLimit) {
    return { status: 'clear' };
  }

  if (classified.requestType === 'discount' && !classified.reason) {
    throw ApiErrorFactory.validationError('Discounts above your self-approval limit require a reason');
  }

  const request = await createApprovalRequest(admin, {
    tenantId: input.tenantId,
    requestType: classified.requestType,
    requestedBy: input.actorId,
    subjectType: classified.subjectType ?? null,
    subjectId: classified.subjectId ?? null,
    amount: classified.amount ?? null,
    percent: classified.percent ?? null,
    reason: classified.reason ?? null,
    actionPayload: input.aiResponse,
    requiredPermission: resolved.requiresPermission,
  });

  return {
    status: 'pending',
    requestId: request.id,
    reply:
      classified.requestType === 'discount'
        ? `Discount request sent for approval (${Math.round(classified.percent ?? 0)}%).`
        : classified.requestType === 'refund'
          ? 'Refund request sent for approval.'
          : 'Stock adjustment request sent for approval.',
  };
}
