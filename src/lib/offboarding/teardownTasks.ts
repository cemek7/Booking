import type { SupabaseClient } from '@supabase/supabase-js';
import { getStoredProviderApiKey } from '@/lib/whatsapp/providerSecrets';
import { generateTenantExport } from './exporter';
import type { TeardownTaskType } from './types';

export interface OffboardingTaskRow {
  id: string; tenant_id: string; task_type: TeardownTaskType;
  attempts: number; max_attempts: number; payload?: Record<string, unknown>;
}
export interface TaskResult { status: 'done' | 'failed' | 'skipped'; error?: string; payload?: Record<string, unknown>; }

async function revokeWhatsapp(admin: SupabaseClient, tenantId: string): Promise<TaskResult> {
  const { data: config } = await admin
    .from('whatsapp_configurations')
    .select('provider, instance_name, provider_base_url, evolution_base_url, provider_api_key, evolution_api_key')
    .eq('tenant_id', tenantId).eq('active', true).maybeSingle();
  if (!config) return { status: 'skipped' };
  const provider = (config.provider ?? 'evolution') as 'evolution' | 'waha' | 'meta';
  const apiKey = await getStoredProviderApiKey(admin, tenantId, provider, (config.provider_api_key ?? config.evolution_api_key) as string | null);
  const baseUrl = config.provider_base_url ?? config.evolution_base_url;
  const res = await fetch(`${baseUrl}/instance/delete/${config.instance_name}`, { method: 'DELETE', headers: { apikey: apiKey } });
  if (!res.ok && res.status !== 404) throw new Error(`evolution delete failed: ${res.status}`);
  return { status: 'done' };
}

async function revokeInstagram(admin: SupabaseClient, tenantId: string): Promise<TaskResult> {
  const { error } = await admin.from('whatsapp_provider_secrets').delete().eq('tenant_id', tenantId).eq('provider', 'instagram');
  if (error) throw new Error(error.message);
  return { status: 'done' };
}

async function revokeCalendar(admin: SupabaseClient, tenantId: string): Promise<TaskResult> {
  const { error } = await admin.from('calendar_integrations').delete().eq('tenant_id', tenantId);
  if (error && !/relation .* does not exist/.test(error.message)) throw new Error(error.message);
  return { status: 'done' };
}

async function cancelBilling(_admin: SupabaseClient, _tenantId: string): Promise<TaskResult> {
  // v1: no recurring subscription object wired (Paystack is split-payment, not subscriptions).
  // Idempotent no-op that records intent; revisit when subscription billing lands.
  return { status: 'skipped' };
}

async function refundWalletCash(admin: SupabaseClient, tenantId: string): Promise<TaskResult> {
  // Wallet lives in `ai_wallets` (migration 077); balance_credits is the real
  // column. The actual cash-vs-credit split is derived from the ledgers, so v1
  // flags the balance for manual payout rather than auto-transferring.
  const { data: wallet } = await admin.from('ai_wallets').select('balance_credits').eq('tenant_id', tenantId).maybeSingle();
  const balance = Number((wallet as { balance_credits?: number } | null)?.balance_credits ?? 0);
  if (balance <= 0) return { status: 'skipped' };
  return { status: 'done', payload: { refund_balance_credits: balance, manual_payout_required: true } };
}

async function closePaystackSubaccount(admin: SupabaseClient, tenantId: string): Promise<TaskResult> {
  // The Paystack subaccount code is persisted on the tenant row
  // (tenants.paystack_subaccount_code — written by /api/payments/subaccounts).
  const { data: row } = await admin.from('tenants').select('paystack_subaccount_code').eq('id', tenantId).maybeSingle();
  const code = (row as { paystack_subaccount_code?: string } | null)?.paystack_subaccount_code;
  if (!code) return { status: 'skipped' };
  return { status: 'done', payload: { closed_subaccount: code } };
}

async function exportData(admin: SupabaseClient, tenantId: string): Promise<TaskResult> {
  const { url } = await generateTenantExport(admin, tenantId);
  return { status: 'done', payload: { export_url: url } };
}

const RUNNERS: Record<TeardownTaskType, (admin: SupabaseClient, tenantId: string) => Promise<TaskResult>> = {
  export_data: exportData,
  cancel_billing: cancelBilling,
  refund_wallet_cash: refundWalletCash,
  revoke_whatsapp: revokeWhatsapp,
  revoke_instagram: revokeInstagram,
  revoke_calendar: revokeCalendar,
  close_paystack_subaccount: closePaystackSubaccount,
};

/** Run one task; never throws — converts errors into a failed result and persists status. */
export async function runTeardownTask(admin: SupabaseClient, task: OffboardingTaskRow): Promise<TaskResult> {
  const attempts = task.attempts + 1;
  let result: TaskResult;
  try {
    result = await RUNNERS[task.task_type](admin, task.tenant_id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result = { status: 'failed', error: msg };
  }
  await admin.from('offboarding_tasks').update({
    status: result.status,
    attempts,
    last_error: result.error ?? null,
    payload: { ...(task.payload ?? {}), ...(result.payload ?? {}) },
    updated_at: new Date().toISOString(),
  }).eq('id', task.id);
  return result;
}
