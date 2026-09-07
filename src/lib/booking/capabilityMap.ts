import { getAllPermissionsForRole } from '@/types/enhanced-permissions';
import { BOOKA_PERMISSIONS } from '@/types/permissions';
import type { Role } from '@/types/roles';

export type Capability =
  | 'refund'
  | 'discount'
  | 'adjust_stock'
  | 'delete'
  | 'manage_staff'
  | 'approve_anomalies';

export const CAP_TO_PERMISSION: Record<Capability, string> = {
  refund: BOOKA_PERMISSIONS.ISSUE_REFUNDS,
  discount: BOOKA_PERMISSIONS.ISSUE_DISCOUNTS,
  adjust_stock: BOOKA_PERMISSIONS.ADJUST_INVENTORY,
  delete: BOOKA_PERMISSIONS.MANAGE_PRODUCTS,
  manage_staff: BOOKA_PERMISSIONS.MANAGE_STAFF,
  approve_anomalies: BOOKA_PERMISSIONS.APPROVE_ANOMALIES,
};

export const ACTION_PERMISSION_MAP: Partial<Record<string, string>> = {
  owner_analytics_query: BOOKA_PERMISSIONS.VIEW_ANALYTICS,
  refund_sale: BOOKA_PERMISSIONS.ISSUE_REFUNDS,
  set_discount: BOOKA_PERMISSIONS.ISSUE_DISCOUNTS,
  adjust_stock: BOOKA_PERMISSIONS.ADJUST_INVENTORY,
  create_stock_count_session: BOOKA_PERMISSIONS.PERFORM_STOCK_COUNTS,
  complete_service_capture: BOOKA_PERMISSIONS.COMPLETE_SERVICES,
  record_expense: BOOKA_PERMISSIONS.RECORD_EXPENSES,
  record_purchase: BOOKA_PERMISSIONS.RECORD_PURCHASES,
  record_supplier_payment: BOOKA_PERMISSIONS.RECORD_PAYMENTS,
  record_stock_receipt: BOOKA_PERMISSIONS.ADJUST_INVENTORY,
  delete_product: BOOKA_PERMISSIONS.MANAGE_PRODUCTS,
  set_staff_capability: BOOKA_PERMISSIONS.MANAGE_STAFF,
};

export function getPermissionForCapability(capability: Capability): string {
  return CAP_TO_PERMISSION[capability];
}

export function getPermissionForAction(action: string): string | undefined {
  return ACTION_PERMISSION_MAP[action];
}

export function hasPermissionInSet(effective: Set<string>, permission: string): boolean {
  return effective.has(permission);
}

export function roleHasAnyCapability(role: Role, capabilities: Capability[]): boolean {
  const granted = new Set(getAllPermissionsForRole(role));
  return capabilities.some((capability) => granted.has(getPermissionForCapability(capability)));
}
