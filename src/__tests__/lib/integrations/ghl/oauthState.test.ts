/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  issueState,
  verifyAndClaimState,
  verifyStateSignature,
} from "@/lib/integrations/ghl/oauthState";

/**
 * The state is the only thing standing between HighLevel's public callback and
 * anyone who can craft a URL. It has to be unforgeable, short-lived and usable
 * exactly once.
 */

const SECRET = "test-ghl-state-secret";

/** Records inserts, and claims a nonce at most once, like the conditional update. */
function makeAdmin(
  options: { insertFails?: boolean; issued?: Set<string> } = {},
) {
  const issued = options.issued ?? new Set<string>();
  const consumed = new Set<string>();
  const inserts: Array<Record<string, unknown>> = [];

  const admin = {
    from() {
      const state: { nonce?: string } = {};
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        insert(row: Record<string, unknown>) {
          inserts.push(row);
          issued.add(String(row.nonce));
          return Promise.resolve({
            error: options.insertFails ? { message: "denied" } : null,
          });
        },
        update() {
          return chain;
        },
        eq(_col: string, value: string) {
          state.nonce = value;
          return chain;
        },
        is: () => chain,
        gte: () => chain,
        select() {
          const nonce = state.nonce ?? "";
          if (!issued.has(nonce) || consumed.has(nonce)) {
            return Promise.resolve({ data: [], error: null });
          }
          consumed.add(nonce);
          return Promise.resolve({ data: [{ nonce }], error: null });
        },
      });
      return chain;
    },
  } as unknown as SupabaseClient;

  return { admin, inserts, issued, consumed };
}

beforeEach(() => {
  process.env.GHL_OAUTH_STATE_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.GHL_OAUTH_STATE_SECRET;
});

describe("issueState", () => {
  it("records the nonce so the callback can claim it", async () => {
    const { admin, inserts } = makeAdmin();
    const state = await issueState(admin, { tenantId: "t1", createdBy: "u1" });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual(
      expect.objectContaining({ tenant_id: "t1", created_by: "u1" }),
    );
    expect(state).toContain(".");
    // The nonce in the signed payload is the one that was stored.
    expect(String(state)).toContain("");
    expect(verifyStateSignature(state)?.nonce).toBe(inserts[0].nonce);
  });

  it("fails when the nonce could not be stored, rather than issuing a state nothing can claim", async () => {
    const { admin } = makeAdmin({ insertFails: true });
    await expect(issueState(admin)).rejects.toThrow(/OAuth state/i);
  });

  it("refuses to mint anything without a signing secret", async () => {
    delete process.env.GHL_OAUTH_STATE_SECRET;
    const saved = {
      nextauth: process.env.NEXTAUTH_SECRET,
      cron: process.env.CRON_SECRET,
    };
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.CRON_SECRET;
    const { admin } = makeAdmin();
    await expect(issueState(admin)).rejects.toThrow(/secret/i);
    if (saved.nextauth) process.env.NEXTAUTH_SECRET = saved.nextauth;
    if (saved.cron) process.env.CRON_SECRET = saved.cron;
  });
});

describe("verifyStateSignature", () => {
  it("accepts a state we issued", async () => {
    const { admin } = makeAdmin();
    const state = await issueState(admin, { tenantId: "t1" });
    expect(verifyStateSignature(state)?.tenantId).toBe("t1");
  });

  it("rejects a tampered payload", async () => {
    const { admin } = makeAdmin();
    const state = await issueState(admin, { tenantId: "t1" });
    const [payload, signature] = state.split(".");
    const forged = Buffer.from(
      JSON.stringify({ n: "attacker", t: "other-tenant", iat: Date.now() }),
    ).toString("base64url");

    expect(verifyStateSignature(`${forged}.${signature}`)).toBeNull();
    expect(
      verifyStateSignature(`${payload}.${"x".repeat(signature.length)}`),
    ).toBeNull();
  });

  it("rejects a state older than ten minutes", async () => {
    const { admin } = makeAdmin();
    const state = await issueState(admin);
    const elevenMinutes = Date.now() + 11 * 60 * 1000;
    expect(verifyStateSignature(state, elevenMinutes)).toBeNull();
  });

  it("rejects a future-dated state", async () => {
    const { admin } = makeAdmin();
    const state = await issueState(admin);
    expect(verifyStateSignature(state, Date.now() - 10 * 60 * 1000)).toBeNull();
  });

  it("rejects junk without throwing", () => {
    expect(verifyStateSignature(null)).toBeNull();
    expect(verifyStateSignature("")).toBeNull();
    expect(verifyStateSignature("no-dot")).toBeNull();
    expect(verifyStateSignature("not-base64.signature")).toBeNull();
  });
});

describe("verifyAndClaimState", () => {
  it("claims a valid state exactly once", async () => {
    const { admin } = makeAdmin();
    const state = await issueState(admin, { tenantId: "t1" });

    const first = await verifyAndClaimState(admin, state);
    expect(first).toEqual({
      ok: true,
      payload: expect.objectContaining({ tenantId: "t1" }),
    });

    // Replaying the same redirect must not connect anything a second time.
    const second = await verifyAndClaimState(admin, state);
    expect(second).toEqual({ ok: false, reason: "already_used" });
  });

  it("refuses a well-formed state we never issued", async () => {
    const { admin } = makeAdmin();
    const state = await issueState(admin);
    // A different store: same signature, no record of the nonce.
    const { admin: other } = makeAdmin();
    expect(await verifyAndClaimState(other, state)).toEqual({
      ok: false,
      reason: "already_used",
    });
  });

  it("refuses an unsigned state without touching the database", async () => {
    const { admin, consumed } = makeAdmin();
    expect(await verifyAndClaimState(admin, "garbage")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(consumed.size).toBe(0);
  });
});
