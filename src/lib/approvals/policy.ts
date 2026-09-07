import { BOOKA_PERMISSIONS } from '@/types/permissions';

export type ApprovalRequestType = 'discount' | 'refund' | 'stock_adjustment';
export type ApprovalRole = 'owner' | 'manager' | 'staff' | 'superadmin';

export interface ApprovalPolicyRow {
  request_type: ApprovalRequestType;
  role: string;
  max_self_approve: number | string;
  requires_permission: string;
}

const DEFAULT_LIMITS: Record<ApprovalRequestType, Record<ApprovalRole, { maxSelfApprove: number; requiresPermission: string }>> = {
  discount: {
    staff: { maxSelfApprove: 5, requiresPermission: BOOKA_PERMISSIONS.APPROVE_LARGE_DISCOUNTS },
    manager: { maxSelfApprove: 15, requiresPermission: BOOKA_PERMISSIONS.APPROVE_LARGE_DISCOUNTS },
    owner: { maxSelfApprove: Number.POSITIVE_INFINITY, requiresPermission: BOOKA_PERMISSIONS.APPROVE_LARGE_DISCOUNTS },
    superadmin: { maxSelfApprove: Number.POSITIVE_INFINITY, requiresPermission: BOOKA_PERMISSIONS.APPROVE_LARGE_DISCOUNTS },
  },
  refund: {
    staff: { maxSelfApprove: 0, requiresPermission: BOOKA_PERMISSIONS.APPROVE_REFUNDS },
    manager: { maxSelfApprove: 0, requiresPermission: BOOKA_PERMISSIONS.APPROVE_REFUNDS },
    owner: { maxSelfApprove: Number.POSITIVE_INFINITY, requiresPermission: BOOKA_PERMISSIONS.APPROVE_REFUNDS },
    superadmin: { maxSelfApprove: Number.POSITIVE_INFINITY, requiresPermission: BOOKA_PERMISSIONS.APPROVE_REFUNDS },
  },
  stock_adjustment: {
    staff: { maxSelfApprove: 0, requiresPermission: BOOKA_PERMISSIONS.ADJUST_INVENTORY },
    manager: { maxSelfApprove: 0, requiresPermission: BOOKA_PERMISSIONS.ADJUST_INVENTORY },
    owner: { maxSelfApprove: Number.POSITIVE_INFINITY, requiresPermission: BOOKA_PERMISSIONS.ADJUST_INVENTORY },
    superadmin: { maxSelfApprove: Number.POSITIVE_INFINITY, requiresPermission: BOOKA_PERMISSIONS.ADJUST_INVENTORY },
  },
};

export interface ResolvedApprovalLimit {
  maxSelfApprove: number;
  requiresPermission: string;
  source: 'default' | 'policy';
}

function normalizeNumber(value: number | string) {
  const next = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(next) ? next : 0;
}

export function resolveLimit(
  role: ApprovalRole,
  requestType: ApprovalRequestType,
  policies: ApprovalPolicyRow[]
): ResolvedApprovalLimit {
  const defaultRule = DEFAULT_LIMITS[requestType][role];
  const matched = policies.find(
    (policy) => policy.request_type === requestType && policy.role.toLowerCase() === role
  );

  if (!matched) {
    return {
      maxSelfApprove: defaultRule.maxSelfApprove,
      requiresPermission: defaultRule.requiresPermission,
      source: 'default',
    };
  }

  return {
    maxSelfApprove: normalizeNumber(matched.max_self_approve),
    requiresPermission: matched.requires_permission,
    source: 'policy',
  };
}
