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
  refund_sale: BOOKA_PERMISSIONS.ISSUE_REFUNDS,
  set_discount: BOOKA_PERMISSIONS.ISSUE_DISCOUNTS,
  adjust_stock: BOOKA_PERMISSIONS.ADJUST_INVENTORY,
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
