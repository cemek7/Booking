import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { isSignupIntent, startSelfSignup, PENDING_TENANT_NAME } from '@/lib/whatsapp/v2/selfSignup';

/**
 * Booka's number is printed on QR codes and shared in bios, so unrecognised
 * traffic on it is mostly wrong numbers. Auto-creating a tenant for each would
 * fill the platform with junk and bill Booka for the messages — which is why
 * signup is an explicit word rather than an inference.
 */

describe('isSignupIntent', () => {
  it.each(['start', 'START', ' Start ', 'signup', 'sign up', 'register', 'new business'])(
    'recognises %p', (t) => expect(isSignupIntent(t)).toBe(true),
  );

  it('tolerates trailing punctuation', () => {
    expect(isSignupIntent('start.')).toBe(true);
    expect(isSignupIntent('Sign up!')).toBe(true);
  });

  it('does NOT fire on a customer sentence that merely contains the word', () => {
    // The whole reason this matches the entire message: these are ordinary
    // things a customer says, and each one would otherwise create a tenant.
    expect(isSignupIntent('what time do you start?')).toBe(false);
    expect(isSignupIntent('can you start earlier')).toBe(false);
    expect(isSignupIntent('I want to register for the class')).toBe(false);
    expect(isSignupIntent('when does the new business open')).toBe(false);
  });

  it('ignores empty and whitespace', () => {
    expect(isSignupIntent('')).toBe(false);
    expect(isSignupIntent('   ')).toBe(false);
    expect(isSignupIntent(null as unknown as string)).toBe(false);
  });
});

// ── startSelfSignup ──────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const inserts: Array<{ table: string; row: Row }> = [];
const upserts: Array<{ table: string; row: Row }> = [];
const deletes: string[] = [];
let existingOwner: Row[] = [];
let tenantInsert: { data: unknown; error: unknown } = { data: { id: 'tenant-new' }, error: null };
let ownerInsertError: unknown = null;

function makeAdmin() {
  return {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      let mode = '';
      Object.assign(q, {
        select: () => q,
        eq: () => q,
        limit: () => Promise.resolve({ data: existingOwner, error: null }),
        insert: (row: Row) => { mode = 'insert'; inserts.push({ table, row }); return q; },
        upsert: (row: Row) => { upserts.push({ table, row }); return Promise.resolve({ error: null }); },
        delete: () => ({ eq: () => { deletes.push(table); return Promise.resolve({ error: null }); } }),
        single: async () => tenantInsert,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
          const out = mode === 'insert' && table === 'tenant_users'
            ? { data: null, error: ownerInsertError }
            : { data: null, error: null };
          return Promise.resolve(out).then(res, rej);
        },
      });
      return q;
    },
  } as never;
}

beforeEach(() => {
  inserts.length = 0; upserts.length = 0; deletes.length = 0;
  existingOwner = [];
  tenantInsert = { data: { id: 'tenant-new' }, error: null };
  ownerInsertError = null;
});

describe('startSelfSignup', () => {
  it('creates an inactive tenant and makes the sender its owner', async () => {
    const res = await startSelfSignup(makeAdmin(), '2348134052165');

    expect(res).toEqual({ tenantId: 'tenant-new', created: true });
    // Inactive until onboarding reaches activation, so an abandoned signup is
    // inert rather than half-live.
    expect(inserts[0]).toMatchObject({
      table: 'tenants', row: { name: PENDING_TENANT_NAME, v2_enabled: false },
    });
    expect(inserts[1]).toMatchObject({
      table: 'tenant_users', row: { role: 'owner', phone: '2348134052165' },
    });
  });

  it('opens the conversation as an OWNER already in the onboarding flow', async () => {
    await startSelfSignup(makeAdmin(), '2348134052165');

    // processMessageV2 creates a missing conversation with role 'unknown', and
    // the pipeline only routes to onboarding for an owner — without this the
    // person signing up is handled as one of their own customers.
    expect(upserts[0]).toMatchObject({
      table: 'whatsapp_conversations',
      row: { role: 'owner', current_flow: 'onboarding' },
    });
  });

  it('never gives the same phone a second tenant', async () => {
    existingOwner = [{ tenant_id: 'tenant-existing' }];

    const res = await startSelfSignup(makeAdmin(), '2348134052165');

    expect(res).toEqual({ tenantId: 'tenant-existing', created: false });
    expect(inserts).toHaveLength(0);
  });

  it('removes the orphan tenant when the owner row cannot be written', async () => {
    // Without the owner row they cannot be resolved next message and would be
    // asked for a business code again, stranded beside a tenant nobody owns.
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    ownerInsertError = { message: 'permission denied' };

    const res = await startSelfSignup(makeAdmin(), '2348134052165');

    expect(res).toBeNull();
    expect(deletes).toContain('tenants');
    warn.mockRestore();
  });

  it('returns null rather than a half-made tenant when the insert fails', async () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    tenantInsert = { data: null, error: { message: 'boom' } };

    expect(await startSelfSignup(makeAdmin(), '2348134052165')).toBeNull();
    warn.mockRestore();
  });
});
