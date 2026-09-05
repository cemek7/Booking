import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/**
 * Covers the email epilogue (steps 6 and 7) and the step-4 handover into it.
 *
 * The point of the epilogue is that WhatsApp-native owners have historically
 * had no email at all, which left them unreachable by the low-balance warning
 * designed to tell them their wallet is running out. So the assertions that
 * matter here are: the address actually lands on tenant_users, a wrong or
 * expired code never strands the owner, and skipping still completes setup.
 */

// ── supabase admin harness ────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const inserts: Array<{ table: string; rows: unknown }> = [];
const updates: Array<{ table: string; patch: Row }> = [];
let singleQueue: Array<{ data: unknown; error: unknown }> = [];
let maybeSingleQueue: Array<{ data: unknown; error: unknown }> = [];
let updateResult: { data: unknown; error: unknown } = { data: null, error: null };

function makeQuery(table: string) {
  const q: Record<string, unknown> = {};
  let isUpdate = false;
  Object.assign(q, {
    select: () => q,
    insert: (rows: unknown) => { inserts.push({ table, rows }); return q; },
    update: (patch: Row) => { isUpdate = true; updates.push({ table, patch }); return q; },
    eq: () => q,
    neq: () => q,
    single: async () => singleQueue.shift() ?? { data: null, error: null },
    maybeSingle: async () => maybeSingleQueue.shift() ?? { data: null, error: null },
    // Terminal await on a builder that was never .single()'d (e.g. an UPDATE).
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(isUpdate ? updateResult : { data: null, error: null }).then(res, rej),
  });
  return q;
}

const admin = { from: (table: string) => makeQuery(table) };
jest.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => admin }));

// ── collaborators ─────────────────────────────────────────────────────────────

const mockUpdateConversation = jest.fn<(...a: unknown[]) => Promise<void>>()
  .mockResolvedValue(undefined);
jest.mock('@/lib/whatsapp/v2/conversationState', () => ({
  updateConversation: (...a: unknown[]) => mockUpdateConversation(...a),
}));

jest.mock('@/lib/whatsapp/v2/identityResolver', () => ({
  generateRoutingCode: async () => 'GLAM01',
}));

const mockSendEmail = jest.fn<(...a: unknown[]) => Promise<{ success: boolean }>>()
  .mockResolvedValue({ success: true });
jest.mock('@/lib/integrations/email-service', () => ({
  sendTransactionalEmail: (...a: unknown[]) => mockSendEmail(...a),
}));

let aiJson = '[]';
jest.mock('@/lib/billing/ai-wallet', () => ({
  estimatePromptTokens: () => 10,
  withTenantWalletSpend: async (
    _admin: unknown, _t: unknown, _o: unknown, fn: () => Promise<unknown>,
  ) => { await fn(); return { json: { choices: [{ message: { content: aiJson } }] } }; },
}));
jest.mock('@/lib/google-ai', () => ({ callGoogleAI: async () => ({}) }));

import { handleOnboarding, handleOwnerEmailUpdate } from '@/lib/whatsapp/v2/flows/ownerOnboarding';
import {
  buildChallenge, generateCode, hashCode, MAX_ATTEMPTS, CODE_TTL_MS,
} from '@/lib/whatsapp/v2/flows/ownerEmailCapture';

const PHONE = '2348012345678';
const TENANT = 'tenant-1';

function conv(flow_data: Row) {
  return {
    id: 'conv-1',
    tenant_id: TENANT,
    phone_number: PHONE,
    external_id: PHONE,
    channel: 'whatsapp' as const,
    role: 'owner' as const,
    current_flow: 'onboarding' as const,
    flow_step: 4,
    flow_data,
    last_inbound_at: null,
    opted_out_at: null,
  };
}

/** The flow_data the flow last persisted through updateConversation. */
function lastFlowData(): Row {
  for (let i = mockUpdateConversation.mock.calls.length - 1; i >= 0; i -= 1) {
    const patch = mockUpdateConversation.mock.calls[i][2] as { flow_data?: Row };
    if (patch?.flow_data) return patch.flow_data;
  }
  throw new Error('no flow_data was persisted');
}

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  singleQueue = [];
  maybeSingleQueue = [];
  updateResult = { data: null, error: null };
  mockUpdateConversation.mockClear();
  mockSendEmail.mockClear().mockResolvedValue({ success: true });
});

// ── Step 4 → 6 ────────────────────────────────────────────────────────────────

describe('step 4 (hours) hands over to email capture', () => {
  beforeEach(() => {
    aiJson = JSON.stringify([{ day_of_week: 1, start_time: '09:00', end_time: '19:00' }]);
    maybeSingleQueue = [{ data: { id: 'tu-1' }, error: null }];      // owner tenant_users row
    singleQueue = [{ data: { name: 'Glamour', metadata: {} }, error: null }]; // tenants read
  });

  it('still activates the tenant before asking for an email', async () => {
    const reply = await handleOnboarding(PHONE, TENANT, 'Mon-Fri 9am-7pm', conv({ onboarding_step: 4 }));

    // Activation is not gated on the email: an owner who stops replying here is
    // live anyway, which is how this flow behaved before email capture existed.
    expect(updates).toContainEqual(
      expect.objectContaining({ table: 'tenants', patch: { routing_code: 'GLAM01', v2_enabled: true } }),
    );
    expect(reply).toContain("You're live!");
    expect(reply).toContain('email');
  });

  it('stays in the onboarding flow so step 6 is reachable', async () => {
    await handleOnboarding(PHONE, TENANT, 'Mon-Fri 9am-7pm', conv({ onboarding_step: 4 }));

    // current_flow 'managing' here would route the next message to the owner-
    // command handler and the email steps would never run.
    const patch = mockUpdateConversation.mock.calls.at(-1)![2] as Row;
    expect(patch.current_flow).toBe('onboarding');
    expect((patch.flow_data as Row).onboarding_step).toBe(6);
  });
});

// ── Step 6: capture ───────────────────────────────────────────────────────────

describe('step 6 — capturing the address', () => {
  it('mails a code and arms the challenge without storing the code itself', async () => {
    const reply = await handleOnboarding(
      PHONE, TENANT, 'sure, ada@salon.ng', conv({ onboarding_step: 6 }),
    );

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const mail = mockSendEmail.mock.calls[0][0] as { to: string; text: string };
    expect(mail.to).toBe('ada@salon.ng');
    const code = /\b(\d{6})\b/.exec(mail.text)![1];

    const fd = lastFlowData();
    expect(fd.onboarding_step).toBe(7);
    expect(fd.email_pending).toBe('ada@salon.ng');
    expect(JSON.stringify(fd)).not.toContain(code);   // hash only, never the code
    expect(fd.email_code_hash).toBe(hashCode(code, TENANT));
    expect(reply).toContain('ada@salon.ng');
  });

  it('does not advance when the address could not be mailed', async () => {
    mockSendEmail.mockResolvedValue({ success: false });

    const reply = await handleOnboarding(
      PHONE, TENANT, 'ada@slaon.nggg', conv({ onboarding_step: 6 }),
    );

    // A dead address is the one signal worth acting on — storing it would read
    // as reachable and silently would not be.
    expect(mockUpdateConversation).not.toHaveBeenCalled();
    expect(reply).toContain('typo');
  });

  it('lets an owner skip and still finishes setup', async () => {
    const reply = await handleOnboarding(PHONE, TENANT, 'skip', conv({ onboarding_step: 6 }));

    const patch = mockUpdateConversation.mock.calls.at(-1)![2] as Row;
    expect(patch.current_flow).toBe('managing');
    expect((patch.flow_data as Row).onboarding_step).toBe(5);
    expect(reply).toContain('WhatsApp number');
    // The copy promises a "my email is ..." command; handleOwnerEmailUpdate is
    // what keeps that promise, and its tests below pin the behaviour. If that
    // command is ever removed, this copy must change with it.
    expect(reply).toContain('my email is');
    expect(typeof handleOwnerEmailUpdate).toBe('function');
    expect(reply).toContain("You're all set");
  });

  it('re-asks rather than skipping when the message is neither', async () => {
    const reply = await handleOnboarding(PHONE, TENANT, 'what for?', conv({ onboarding_step: 6 }));
    expect(mockUpdateConversation).not.toHaveBeenCalled();
    expect(reply).toContain("didn't catch an email");
  });
});

// ── Step 7: verification ──────────────────────────────────────────────────────

describe('step 7 — verifying the code', () => {
  const CODE = '123456';
  const armed = () => ({
    onboarding_step: 7,
    ...buildChallenge('ada@salon.ng', CODE, TENANT),
  });

  it('writes the verified address onto the owner row and completes', async () => {
    const reply = await handleOnboarding(PHONE, TENANT, CODE, conv(armed()));

    expect(updates).toContainEqual({ table: 'tenant_users', patch: { email: 'ada@salon.ng' } });
    expect(reply).toContain('confirmed');

    // The challenge must not outlive the conversation that issued it.
    const fd = lastFlowData();
    expect(fd.onboarding_step).toBe(5);
    expect(fd.email_code_hash).toBeUndefined();
    expect(fd.email_pending).toBeUndefined();
  });

  it('does not claim success when the write failed', async () => {
    updateResult = { data: null, error: { message: 'permission denied' } };

    const reply = await handleOnboarding(PHONE, TENANT, CODE, conv(armed()));

    // supabase-js resolves with an error rather than throwing; unchecked, this
    // would tell the owner they are reachable when nothing was stored.
    expect(reply).not.toContain('confirmed');
    expect(reply).toContain("couldn't save");
  });

  it('spends an attempt on a wrong code and says how many are left', async () => {
    const reply = await handleOnboarding(PHONE, TENANT, '999999', conv(armed()));

    expect(lastFlowData().email_code_attempts).toBe(1);
    expect(reply).toContain(`${MAX_ATTEMPTS - 1} tries left`);
    expect(updates).not.toContainEqual(expect.objectContaining({ table: 'tenant_users' }));
  });

  it('sends the owner back to step 6 once the code expires, not into a dead end', async () => {
    const stale = {
      onboarding_step: 7,
      ...buildChallenge('ada@salon.ng', CODE, TENANT, Date.now() - CODE_TTL_MS - 1000),
    };

    const reply = await handleOnboarding(PHONE, TENANT, CODE, conv(stale));

    const fd = lastFlowData();
    expect(fd.onboarding_step).toBe(6);
    expect(fd.email_code_hash).toBeUndefined();
    expect(reply).toContain('expired');
  });

  it('sends the owner back to step 6 after the attempt limit', async () => {
    const spent = { ...armed(), email_code_attempts: MAX_ATTEMPTS };

    const reply = await handleOnboarding(PHONE, TENANT, '000000', conv(spent));

    expect(lastFlowData().onboarding_step).toBe(6);
    expect(reply).toContain('Too many wrong codes');
  });

  it('re-issues to the same address rather than ignoring a repeat', async () => {
    await handleOnboarding(PHONE, TENANT, 'ada@salon.ng', conv(armed()));
    expect((mockSendEmail.mock.calls[0][0] as { to: string }).to).toBe('ada@salon.ng');
    expect(lastFlowData().email_code_hash).not.toBe(
      buildChallenge('ada@salon.ng', CODE, TENANT).email_code_hash,
    );
  });

  it('treats a second address as a correction and re-issues to it', async () => {
    const reply = await handleOnboarding(
      PHONE, TENANT, 'sorry its ada@salon.com', conv(armed()),
    );

    expect((mockSendEmail.mock.calls[0][0] as { to: string }).to).toBe('ada@salon.com');
    expect(lastFlowData().email_pending).toBe('ada@salon.com');
    expect(reply).toContain('ada@salon.com');
  });

  it('resends a fresh code on request without revealing the full address', async () => {
    const reply = await handleOnboarding(PHONE, TENANT, 'resend', conv(armed()));

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const newCode = /\b(\d{6})\b/.exec((mockSendEmail.mock.calls[0][0] as { text: string }).text)![1];
    expect(lastFlowData().email_code_hash).toBe(hashCode(newCode, TENANT));
    expect(reply).toContain('ad*@salon.ng');
  });

  it('completes instead of looping when there is no pending challenge', async () => {
    const reply = await handleOnboarding(PHONE, TENANT, '123456', conv({ onboarding_step: 7 }));

    expect(lastFlowData().onboarding_step).toBe(5);
    expect(reply).toContain("You're all set");
  });
});

describe('completed owners', () => {
  it('are not asked for an email again', async () => {
    const reply = await handleOnboarding(PHONE, TENANT, 'hi', conv({ onboarding_step: 5 }));
    expect(reply).toContain('setup is complete');
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe('generateCode', () => {
  it('never emits a code the hash of one tenant would match for another', () => {
    const code = generateCode();
    expect(hashCode(code, 'tenant-a')).not.toBe(hashCode(code, 'tenant-b'));
  });
});

// ── Post-onboarding "my email is ..." ─────────────────────────────────────────

describe('handleOwnerEmailUpdate', () => {
  const done = () => ({ ...conv({ onboarding_step: 5 }), current_flow: 'managing' as const });

  it('ignores messages that are not about email', async () => {
    expect(await handleOwnerEmailUpdate(PHONE, TENANT, "who's booked tomorrow?", done())).toBeNull();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('ignores a bare address with no mention of email', async () => {
    // Otherwise any owner message containing an address would hijack the turn.
    expect(await handleOwnerEmailUpdate(PHONE, TENANT, 'invoice ada@salon.ng please', done())).toBeNull();
  });

  it('ignores staff, who cannot change the owner contact', async () => {
    const staff = { ...done(), role: 'staff' as const };
    expect(await handleOwnerEmailUpdate(PHONE, TENANT, 'my email is ada@salon.ng', staff)).toBeNull();
  });

  it('sends a code and routes the conversation back to the verification step', async () => {
    const reply = await handleOwnerEmailUpdate(PHONE, TENANT, 'my email is ada@salon.ng', done());

    expect((mockSendEmail.mock.calls[0][0] as { to: string }).to).toBe('ada@salon.ng');
    // Without current_flow 'onboarding' the code the owner types next goes to
    // the owner-command handler and the verification never completes.
    const patch = mockUpdateConversation.mock.calls.at(-1)![2] as Row;
    expect(patch.current_flow).toBe('onboarding');
    expect((patch.flow_data as Row).onboarding_step).toBe(7);
    expect(reply).toContain('ada@salon.ng');
  });

  it('asks again when the message mentions email but has no address', async () => {
    const reply = await handleOwnerEmailUpdate(PHONE, TENANT, 'change my email please', done());
    expect(reply).toContain("couldn't read an email address");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('completes end to end: the code lands and the address is stored', async () => {
    await handleOwnerEmailUpdate(PHONE, TENANT, 'my email is ada@salon.ng', done());
    const code = /\b(\d{6})\b/.exec((mockSendEmail.mock.calls[0][0] as { text: string }).text)![1];
    const armedState = lastFlowData();

    const reply = await handleOnboarding(PHONE, TENANT, code, conv(armedState));

    expect(updates).toContainEqual({ table: 'tenant_users', patch: { email: 'ada@salon.ng' } });
    expect(reply).toContain('confirmed');
    // And the owner is handed back to normal command handling.
    expect((mockUpdateConversation.mock.calls.at(-1)![2] as Row).current_flow).toBe('managing');
  });
});
