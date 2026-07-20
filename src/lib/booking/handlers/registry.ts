import type { SupabaseClient } from '@supabase/supabase-js';
import type { Capability } from '../capabilityMap';

export interface ActionContext {
  role?: string;
  channel?: string;
  actorId?: string | null;
  customerPhone?: string;
  tenantStaffId?: string;
  customerId?: string;
  messageId?: string;
  userRole?: 'owner' | 'staff' | 'customer';
}

export interface ActionHandler {
  action: string;
  capability?: Capability;
  requiresConfirmation: boolean;
  validate(
    admin: SupabaseClient,
    tenantId: string,
    params: Record<string, unknown>,
    ctx: ActionContext
  ): Promise<{ valid: boolean; error?: string }>;
  execute(
    admin: SupabaseClient,
    tenantId: string,
    params: Record<string, unknown>,
    ctx: ActionContext
  ): Promise<{ success: boolean; error?: string; reply?: string }>;
}

export const HANDLERS: Record<string, ActionHandler> = {};

export async function dispatchValidate(
  admin: SupabaseClient,
  tenantId: string,
  action: string,
  params: Record<string, unknown>,
  ctx: ActionContext
): Promise<{ handled: boolean; result?: { valid: boolean; error?: string } }> {
  const handler = HANDLERS[action];
  if (!handler) return { handled: false };
  return {
    handled: true,
    result: await handler.validate(admin, tenantId, params, ctx),
  };
}

export async function dispatchExecute(
  admin: SupabaseClient,
  tenantId: string,
  action: string,
  params: Record<string, unknown>,
  ctx: ActionContext
): Promise<{ handled: boolean; result?: { success: boolean; error?: string; reply?: string } }> {
  const handler = HANDLERS[action];
  if (!handler) return { handled: false };
  return {
    handled: true,
    result: await handler.execute(admin, tenantId, params, ctx),
  };
}
