/**
 * Scoped, self-cleaning LIVE smoke of the v2 chat onboarding.
 *
 * WHY THIS EXISTS. Every defect found in this flow by hand was a PERSISTENCE
 * bug, not a parsing one: the staff name was parsed and never written, the
 * specialties were parsed and never linked, the timezone was never asked for,
 * and the working hours went to the owner alone. Each produced a tenant that
 * looked onboarded and could not take a booking, and every unit test passed
 * throughout — because the unit tests assert on a mock's recorded writes, which
 * is precisely the thing that was wrong.
 *
 * So this runs the real flow against a real Postgres and then asks the actual
 * question: after the conversation ends, can a customer book this business?
 * The last assertion calls the slot engine. That is the one that would have
 * caught the staff-schedule bug, because unbookable staff return an empty array
 * rather than an error.
 *
 * The LLM is the one thing stubbed. It costs money and a token budget per run,
 * and no bug in this flow has ever been a parsing bug — mocking it keeps the
 * smoke runnable in CI while leaving every database write real.
 *
 * Everything is scoped to one throwaway tenant, deleted in afterAll even if an
 * assertion fails.
 *
 * Run: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *      npx jest --config jest.livesmoke.config.cjs --runInBand v2-onboarding
 */
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const MARK = `__livesmoke_v2_${Date.now()}`;
const OWNER_PHONE = `+23480${String(Date.now()).slice(-8)}`;

// The model's job in this flow is turning a sentence into JSON. Stub only that.
let nextAiJson = '{}';
jest.mock('@/lib/google-ai', () => ({ callGoogleAI: async () => ({}) }));
jest.mock('@/lib/billing/ai-wallet', () => ({
  estimatePromptTokens: () => 10,
  withTenantWalletSpend: async (
    _admin: unknown, _t: unknown, _o: unknown, fn: () => Promise<unknown>,
  ) => {
    await fn();
    return { json: { choices: [{ message: { content: nextAiJson } }] } };
  },
}));

import { handleOnboarding } from '@/lib/whatsapp/v2/flows/ownerOnboarding';
import { getAvailableSlots } from '@/lib/whatsapp/v2/slotEngine';
import { getConversation } from '@/lib/whatsapp/v2/conversationState';
import { startSelfSignup, isSignupIntent } from '@/lib/whatsapp/v2/selfSignup';

let admin: SupabaseClient;
let tenantId = '';

/** Re-reads the conversation so each step sees what the last one persisted. */
async function step(message: string, aiJson: string): Promise<string> {
  nextAiJson = aiJson;
  const conv = await getConversation(OWNER_PHONE, tenantId, 'whatsapp');
  return handleOnboarding(OWNER_PHONE, tenantId, message, conv);
}

beforeAll(async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the live smoke');
  }
  admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Enter the way a real owner does: an unrecognised number replying START.
  // Starting from a hand-made tenant was what let the step 1 bug hide.
  expect(isSignupIntent('START')).toBe(true);
  const signup = await startSelfSignup(admin, OWNER_PHONE);
  if (!signup) throw new Error('self signup failed');
  tenantId = signup.tenantId;

  // Name it so teardown can find it even if the test dies mid-way.
  await admin.from('tenants').update({ name: MARK }).eq('id', tenantId);
}, 60_000);

afterAll(async () => {
  if (!admin || !tenantId) return;
  // FK-safe order, strictly scoped to the throwaway tenant.
  for (const table of [
    'staff_services', 'staff_schedules', 'services',
    'whatsapp_conversations', 'tenant_users', 'ai_wallet_ledger', 'ai_wallets',
  ]) {
    try { await admin.from(table).delete().eq('tenant_id', tenantId); } catch { /* ignore */ }
  }
  try { await admin.from('tenants').delete().eq('id', tenantId); } catch { /* ignore */ }
}, 60_000);

describe('v2 chat onboarding produces a tenant that can actually take a booking', () => {
  it('walks the whole conversation and leaves a bookable business behind', async () => {
    // ── the conversation ──────────────────────────────────────────────────
    // Signup already opened this as an owner in the onboarding flow, so the
    // first turn is the greeting and it must ADVANCE — that is the bug where an
    // owner could answer correctly forever and keep being greeted.
    const greeting = await step('', '{}');
    expect(greeting).toContain("I'm Booka");
    const afterGreeting = await getConversation(OWNER_PHONE, tenantId, 'whatsapp');
    expect(afterGreeting?.flow_data?.onboarding_step).toBe(1);

    await step('Glamour Hair Studio, hair salon in Yaba Lagos', JSON.stringify({
      business_name: 'Glamour Hair Studio', vertical: 'beauty',
      location: 'Yaba, Lagos', timezone: 'Africa/Lagos',
    }));
    await step('Braids 5000, Frontal 15000', JSON.stringify([
      { name: 'Braids', price: 5000, duration_minutes: 60 },
      { name: 'Frontal', price: 15000, duration_minutes: 90 },
    ]));
    await step('Adaeze does braids, Chioma does frontal', JSON.stringify([
      { name: 'Adaeze', specialties: ['braids'] },
      { name: 'Chioma', specialties: ['frontal'] },
    ]));
    const live = await step('Mon-Fri 9am-7pm', JSON.stringify(
      [1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, start_time: '09:00', end_time: '19:00' })),
    ));
    expect(live).toContain("You're live!");

    // ── the tenant is configured, not merely created ──────────────────────
    const { data: tenantRow } = await admin
      .from('tenants').select('timezone, routing_code, v2_enabled').eq('id', tenantId).single();
    const t = tenantRow as { timezone: string | null; routing_code: string | null; v2_enabled: boolean };
    expect(t.routing_code).toBeTruthy();
    expect(t.v2_enabled).toBe(true);
    // Null here means every consumer silently falls back to UTC and a 9am
    // Lagos appointment is read back an hour out.
    expect(t.timezone).toBeTruthy();
    expect(t.timezone).not.toBe('UTC');

    // ── the team survived the conversation ────────────────────────────────
    const { data: peopleRows } = await admin
      .from('tenant_users').select('id, role, name, services_all').eq('tenant_id', tenantId);
    const people = (peopleRows ?? []) as Array<{
      id: string; role: string; name: string | null; services_all: boolean;
    }>;

    const owner = people.find((p) => p.role === 'owner');
    expect(owner).toBeDefined();
    expect(owner!.name).toBeTruthy();

    const staff = people.filter((p) => p.role === 'staff');
    expect(staff).toHaveLength(2);
    // The owner named them. A blank here is a person nobody can book by name.
    expect(staff.map((s) => s.name).sort()).toEqual(['Adaeze', 'Chioma']);

    // ── specialties reached the table the booking engine reads ────────────
    const { data: linkRows } = await admin
      .from('staff_services').select('staff_user_id, service_id').eq('tenant_id', tenantId);
    const links = (linkRows ?? []) as Array<{ staff_user_id: string; service_id: string }>;
    expect(links.length).toBeGreaterThanOrEqual(2);

    // ── EVERY member has hours, not just the owner ────────────────────────
    const { data: schedRows } = await admin
      .from('staff_schedules').select('tenant_user_id').eq('tenant_id', tenantId);
    const scheduled = new Set(
      ((schedRows ?? []) as Array<{ tenant_user_id: string }>).map((r) => r.tenant_user_id),
    );
    for (const person of people) {
      expect(scheduled.has(person.id)).toBe(true);
    }

    // ── the question that actually matters ────────────────────────────────
    // Unbookable staff return an empty array rather than an error, so this is
    // the only assertion that distinguishes "rows exist" from "it works".
    const adaeze = staff.find((s) => s.name === 'Adaeze')!;
    const braids = links.find((l) => l.staff_user_id === adaeze.id)!;
    const nextMonday = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
      return d.toISOString().slice(0, 10);
    })();

    const slots = await getAvailableSlots(tenantId, adaeze.id, nextMonday, braids.service_id);
    expect(slots.length).toBeGreaterThan(0);
  }, 120_000);
});
