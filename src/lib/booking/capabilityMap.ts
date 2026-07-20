import type { Role } from '@/types';

export type Capability =
  | 'refund'
  | 'discount'
  | 'adjust_stock'
  | 'delete'
  | 'manage_staff';

const MANAGER_CAPABILITIES: Capability[] = [
  'discount',
  'adjust_stock',
];

const STAFF_CAPABILITIES: Capability[] = [
  'adjust_stock',
];

export function hasCapability(role: string, capability: Capability): boolean {
  if (role === 'superadmin' || role === 'owner') return true;
  if (role === 'manager') return MANAGER_CAPABILITIES.includes(capability);
  if (role === 'staff') return STAFF_CAPABILITIES.includes(capability);
  return false;
}

export const ACTION_CAPABILITY_MAP: Partial<Record<string, Capability>> = {
  refund_sale: 'refund',
  set_discount: 'discount',
  adjust_stock: 'adjust_stock',
  delete_product: 'delete',
  set_staff_capability: 'manage_staff',
};

export function getCapabilityForAction(action: string): Capability | undefined {
  return ACTION_CAPABILITY_MAP[action];
}

export function roleHasAnyCapability(role: Role, capabilities: Capability[]): boolean {
  return capabilities.some((capability) => hasCapability(role, capability));
}
