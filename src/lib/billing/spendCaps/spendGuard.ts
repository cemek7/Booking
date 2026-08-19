import type { SupabaseClient } from '@supabase/supabase-js';
import { CAPS } from './config';

export interface CapDecision {
  allowed: boolean;
  reason: 'ok' | 'velocity_cap' | 'daily_cap';
  softWarn: boolean;
  spentTodayCredits: number;
  dailyBudgetCredits: number;
}

type WalletCapRow = {
  daily_budget_credits?: number | null;
  velocity_credits_override?: number | null;
};

function timezoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - date.getTime();
}

function startOfTodayForTimezone(timeZone?: string | null): string {
  if (!timeZone) {
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    return now.toISOString();
  }

  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const guess = new Date(Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      0,
      0,
      0,
    ));
    const offset = timezoneOffsetMs(guess, timeZone);
    return new Date(guess.getTime() - offset).toISOString();
  } catch {
    const fallback = new Date();
    fallback.setUTCHours(0, 0, 0, 0);
    return fallback.toISOString();
  }
}

function spendFromRows(rows: Array<{ amount_credits?: number | string | null }>): number {
  const total = rows.reduce((sum, row) => sum + Number(row.amount_credits ?? 0), 0);
  return Math.max(0, -total);
}

async function spendSince(admin: SupabaseClient, tenantId: string, sinceIso: string): Promise<number> {
  const { data, error } = await admin
    .from('ai_wallet_ledger')
    .select('amount_credits')
    .eq('tenant_id', tenantId)
    .neq('kind', 'topup')
    .gte('created_at', sinceIso);

  if (error) throw new Error(error.message);

  return spendFromRows((data ?? []) as Array<{ amount_credits?: number | string | null }>);
}

export async function checkCaps(admin: SupabaseClient, tenantId: string): Promise<CapDecision> {
  try {
    const [
      { data: wallet, error: walletError },
      { data: tenant, error: tenantError },
    ] = await Promise.all([
      admin
        .from('ai_wallets')
        .select('daily_budget_credits, velocity_credits_override')
        .eq('tenant_id', tenantId)
        .maybeSingle(),
      admin
        .from('tenants')
        .select('timezone')
        .eq('id', tenantId)
        .maybeSingle(),
    ]);

    if (walletError && walletError.code !== 'PGRST116') {
      throw new Error(walletError.message);
    }
    if (tenantError && tenantError.code !== 'PGRST116') {
      throw new Error(tenantError.message);
    }

    const capRow = (wallet ?? null) as WalletCapRow | null;
    const dailyBudget = CAPS.resolveDailyBudget(capRow?.daily_budget_credits);
    const velocityCap = CAPS.resolveVelocity(capRow?.velocity_credits_override);
    const tenantTimezone = typeof tenant?.timezone === 'string' ? tenant.timezone : null;

    const velocitySpend = await spendSince(
      admin,
      tenantId,
      new Date(Date.now() - CAPS.velocityWindowMs()).toISOString(),
    );
    const todaySpend = await spendSince(admin, tenantId, startOfTodayForTimezone(tenantTimezone));

    if (CAPS.enforced() && velocitySpend >= velocityCap) {
      return {
        allowed: false,
        reason: 'velocity_cap',
        softWarn: false,
        spentTodayCredits: todaySpend,
        dailyBudgetCredits: dailyBudget,
      };
    }

    if (CAPS.enforced() && todaySpend >= dailyBudget) {
      return {
        allowed: false,
        reason: 'daily_cap',
        softWarn: false,
        spentTodayCredits: todaySpend,
        dailyBudgetCredits: dailyBudget,
      };
    }

    return {
      allowed: true,
      reason: 'ok',
      softWarn: dailyBudget > 0 && todaySpend >= CAPS.softWarnPct() * dailyBudget,
      spentTodayCredits: todaySpend,
      dailyBudgetCredits: dailyBudget,
    };
  } catch (error) {
    console.warn('[spendGuard] checkCaps failed open', error);
    return {
      allowed: true,
      reason: 'ok',
      softWarn: false,
      spentTodayCredits: 0,
      dailyBudgetCredits: 0,
    };
  }
}
