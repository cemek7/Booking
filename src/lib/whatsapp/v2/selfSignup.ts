import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The way a new business gets into Booka over chat.
 *
 * Before this, the shared gateway answered an unrecognised sender with "reply
 * with its 6-character business code" and dropped the message. A prospective
 * owner has no code — they have not signed up yet — so the flow they were told
 * to use had no entry point at all.
 *
 * The hard part is not creating the tenant; it is telling a prospective owner
 * apart from a customer who messaged the wrong number. Booka's number is
 * printed on QR codes and shared in bios, so unrecognised traffic is mostly
 * wrong numbers, and auto-creating a tenant for each one would fill the
 * platform with junk and bill Booka for the messages.
 *
 * So signup is EXPLICIT: the routing prompt offers it, and only a deliberate
 * word starts it. That costs a prospective owner one extra message and makes an
 * accidental tenant essentially impossible.
 */

/** Placeholder until step 1 of onboarding learns the real name. */
export const PENDING_TENANT_NAME = 'New Booka business';

/**
 * Deliberately narrow. A customer asking "what time do you start?" or "can you
 * start earlier" must never create a tenant, so this matches the whole message
 * and not a substring of it.
 */
const SIGNUP_PHRASES = [
  'start',
  'signup',
  'sign up',
  'register',
  'new business',
  'set up my business',
  'setup my business',
  'i want to use booka',
  'create account',
];

export function isSignupIntent(text: string): boolean {
  const t = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.!?,]+$/, '');
  if (!t) return false;
  return SIGNUP_PHRASES.includes(t);
}

export interface SignupResult {
  tenantId: string;
  created: boolean;
}

/**
 * Creates the shell a chat onboarding fills in: a tenant that is NOT activated,
 * plus the owner's membership keyed on the phone they messaged from.
 *
 * The owner row is what makes them resolvable next time — identityResolver's
 * resolveByPhone finds a tenant_users row by phone, so after this every
 * subsequent message routes to their own tenant without a code.
 *
 * v2_enabled stays false until onboarding reaches activation, so a tenant
 * abandoned halfway is inert rather than half-live.
 */
export async function startSelfSignup(
  admin: SupabaseClient,
  phone: string,
): Promise<SignupResult | null> {
  // Someone who already owns a tenant should never get a second one. This
  // should be unreachable — the caller only gets here when the resolver found
  // nothing, and the resolver checks this same table — but a duplicate tenant
  // is expensive enough to be worth the extra read.
  const { data: existing } = await admin
    .from('tenant_users')
    .select('tenant_id')
    .eq('phone', phone)
    .eq('role', 'owner')
    .limit(1);

  const already = (existing ?? []) as Array<{ tenant_id: string }>;
  if (already.length > 0) {
    return { tenantId: already[0].tenant_id, created: false };
  }

  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .insert({ name: PENDING_TENANT_NAME, v2_enabled: false })
    .select('id')
    .single();

  if (tenantError || !tenant) {
    console.error('[selfSignup] could not create the tenant', { error: tenantError });
    return null;
  }

  const tenantId = (tenant as { id: string }).id;

  const { error: ownerError } = await admin.from('tenant_users').insert({
    tenant_id: tenantId,
    role: 'owner',
    phone,
    services_all: true,
  });

  if (ownerError) {
    // Without the owner row they cannot be resolved next message and would be
    // asked for a business code again, stranded beside an orphan tenant. Undo.
    console.error('[selfSignup] owner row failed, removing the orphan tenant', {
      tenantId, error: ownerError,
    });
    await admin.from('tenants').delete().eq('id', tenantId);
    return null;
  }

  // The conversation must exist as an OWNER already in the onboarding flow.
  // processMessageV2 creates a missing conversation with role 'unknown', and
  // the pipeline only routes to handleOnboarding when current_flow is
  // 'onboarding' or the sender is an owner — so without this the person who
  // just asked to sign up would be handled as one of their own customers.
  const { error: convError } = await admin.from('whatsapp_conversations').upsert(
    {
      channel: 'whatsapp',
      external_id: phone,
      phone_number: phone,
      tenant_id: tenantId,
      role: 'owner',
      current_flow: 'onboarding',
      flow_step: 0,
      flow_data: { onboarding_step: 0 },
    },
    { onConflict: 'phone_number,tenant_id' },
  );

  if (convError) {
    console.error('[selfSignup] could not open the onboarding conversation', {
      tenantId, error: convError,
    });
    // The tenant and owner row are sound, so do not delete them — the next
    // message resolves by phone and the pipeline opens a conversation itself.
    // Report success: they are signed up, just not greeted yet.
  }

  return { tenantId, created: true };
}
