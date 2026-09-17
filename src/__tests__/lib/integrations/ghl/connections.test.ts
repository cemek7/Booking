/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readAccessToken,
  saveConnection,
} from "@/lib/integrations/ghl/connections";

/**
 * Tokens are credentials. The only property that matters here is that what
 * reaches a column is ciphertext, and that it round-trips.
 */

const TOKENS = {
  accessToken: "ghl-access-token-value",
  refreshToken: "ghl-refresh-token-value",
  expiresInSeconds: 86400,
  scope: "locations.readonly",
  userType: "Location",
  locationId: "loc-1",
  companyId: "co-1",
  userId: "user-1",
};

function makeAdmin(row: Record<string, unknown> | null = null, fail = false) {
  const writes: Array<{ op: string; row: Record<string, unknown> }> = [];
  const admin = {
    from() {
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        upsert(r: Record<string, unknown>) {
          writes.push({ op: "upsert", row: r });
          return Promise.resolve({
            error: fail ? { message: "denied" } : null,
          });
        },
        insert(r: Record<string, unknown>) {
          writes.push({ op: "insert", row: r });
          return Promise.resolve({
            error: fail ? { message: "denied" } : null,
          });
        },
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: row, error: null }),
      });
      return chain;
    },
  } as unknown as SupabaseClient;
  return { admin, writes };
}

beforeEach(() => {
  // 32 bytes, hex. Test-only value.
  process.env.ENCRYPTION_KEY = "a".repeat(64);
});

afterEach(() => {
  delete process.env.ENCRYPTION_KEY;
});

describe("saveConnection", () => {
  it("writes ciphertext, never the token itself", async () => {
    const { admin, writes } = makeAdmin();

    await expect(
      saveConnection(admin, { tenantId: "t1", tokens: TOKENS }),
    ).resolves.toEqual({
      ok: true,
    });

    const row = writes[0].row;
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(TOKENS.accessToken);
    expect(serialized).not.toContain(TOKENS.refreshToken);
    expect(row.encrypted_access_token).toEqual(expect.any(String));
    expect(row.access_token_iv).toEqual(expect.any(String));
    expect(String(row.encryption_key_version)).toContain("aes-256-gcm");
    expect(row.location_id).toBe("loc-1");
  });

  it("upserts on location so re-installing replaces the credentials", async () => {
    const { admin, writes } = makeAdmin();
    await saveConnection(admin, { tenantId: null, tokens: TOKENS });
    expect(writes[0].op).toBe("upsert");
  });

  it("inserts when HighLevel returned no location", async () => {
    const { admin, writes } = makeAdmin();
    await saveConnection(admin, {
      tenantId: null,
      tokens: { ...TOKENS, locationId: null },
    });
    expect(writes[0].op).toBe("insert");
  });

  it("records an expiry derived from expires_in", async () => {
    const { admin, writes } = makeAdmin();
    const now = new Date("2026-09-17T00:00:00.000Z");
    await saveConnection(admin, { tenantId: null, tokens: TOKENS, now });
    expect(writes[0].row.token_expires_at).toBe("2026-09-18T00:00:00.000Z");
  });

  it("reports failure rather than throwing, since supabase-js resolves with an error", async () => {
    const { admin } = makeAdmin(null, true);
    await expect(
      saveConnection(admin, { tenantId: null, tokens: TOKENS }),
    ).resolves.toEqual({
      ok: false,
    });
  });
});

describe("readAccessToken", () => {
  it("round-trips a stored token", async () => {
    const { admin, writes } = makeAdmin();
    await saveConnection(admin, { tenantId: null, tokens: TOKENS });
    const stored = writes[0].row;

    const { admin: reader } = makeAdmin({
      encrypted_access_token: stored.encrypted_access_token,
      access_token_iv: stored.access_token_iv,
      encryption_key_version: stored.encryption_key_version,
      revoked_at: null,
    });

    await expect(readAccessToken(reader, "loc-1")).resolves.toBe(
      TOKENS.accessToken,
    );
  });

  it("returns nothing for a revoked connection", async () => {
    const { admin, writes } = makeAdmin();
    await saveConnection(admin, { tenantId: null, tokens: TOKENS });
    const stored = writes[0].row;

    const { admin: reader } = makeAdmin({
      encrypted_access_token: stored.encrypted_access_token,
      access_token_iv: stored.access_token_iv,
      encryption_key_version: stored.encryption_key_version,
      revoked_at: "2026-09-17T00:00:00.000Z",
    });

    await expect(readAccessToken(reader, "loc-1")).resolves.toBeNull();
  });

  it("returns nothing when the ciphertext cannot be decrypted", async () => {
    const { admin } = makeAdmin({
      encrypted_access_token: "bm90LXJlYWwtY2lwaGVydGV4dA==",
      access_token_iv: "AAAAAAAAAAAAAAAA",
      encryption_key_version: "aes-256-gcm:deadbeef",
      revoked_at: null,
    });
    await expect(readAccessToken(admin, "loc-1")).resolves.toBeNull();
  });
});
