import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * OAuth `state` for the GoHighLevel install flow: signed, expiring and
 * single-use.
 *
 * The signature proves we minted it, so a third party cannot start a flow that
 * lands on our callback. The expiry bounds how long a leaked redirect is worth
 * anything. Neither stops the same successful redirect being replayed, so the
 * nonce is also recorded in the database and claimed exactly once — a second
 * attempt with the same state is refused even though its signature is perfect.
 */

const MAX_AGE_MS = 10 * 60 * 1000;

function stateSecret(): string {
  return (
    process.env.GHL_OAUTH_STATE_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.CRON_SECRET ||
    ""
  );
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export interface GhlStatePayload {
  nonce: string;
  tenantId: string | null;
  issuedAt: number;
}

/** Mints a signed state and records its nonce so it can only be used once. */
export async function issueState(
  admin: SupabaseClient,
  input: { tenantId?: string | null; createdBy?: string | null } = {},
): Promise<string> {
  const secret = stateSecret();
  if (!secret) throw new Error("GHL OAuth state secret is not configured");

  const nonce = randomBytes(24).toString("base64url");
  const issuedAt = Date.now();

  const { error } = await admin.from("highlevel_oauth_states").insert({
    nonce,
    tenant_id: input.tenantId ?? null,
    created_by: input.createdBy ?? null,
    expires_at: new Date(issuedAt + MAX_AGE_MS).toISOString(),
  });
  // supabase-js resolves with an error rather than throwing. Without the row the
  // callback could never claim the nonce, so failing here is the honest outcome.
  if (error) throw new Error("Could not record the OAuth state");

  const payload = Buffer.from(
    JSON.stringify({ n: nonce, t: input.tenantId ?? null, iat: issuedAt }),
  ).toString("base64url");

  return `${payload}.${sign(payload, secret)}`;
}

/** Signature and expiry only. Says nothing about whether it was already used. */
export function verifyStateSignature(
  state: string | null | undefined,
  now: number = Date.now(),
): GhlStatePayload | null {
  const secret = stateSecret();
  if (!secret || !state || !state.includes(".")) return null;

  const [payload, signature] = state.split(".", 2);
  if (!payload || !signature) return null;

  const expected = sign(payload, secret);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  // Constant-time, and length-checked first because timingSafeEqual throws on
  // a length mismatch.
  if (given.length !== want.length || !timingSafeEqual(given, want))
    return null;

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { n?: string; t?: string | null; iat?: number };

    if (!decoded.n || typeof decoded.iat !== "number") return null;
    if (now - decoded.iat > MAX_AGE_MS) return null;
    if (now + 60_000 < decoded.iat) return null; // clock-skew tolerant, not future-dated

    return {
      nonce: decoded.n,
      tenantId: decoded.t ?? null,
      issuedAt: decoded.iat,
    };
  } catch {
    return null;
  }
}

export type StateClaim =
  | { ok: true; payload: GhlStatePayload }
  | { ok: false; reason: "invalid" | "already_used" | "unknown_state" };

/**
 * Verifies and then claims the state. The claim is a conditional update, so two
 * simultaneous callbacks cannot both succeed: only one matches consumed_at IS
 * NULL.
 */
export async function verifyAndClaimState(
  admin: SupabaseClient,
  state: string | null | undefined,
  now: Date = new Date(),
): Promise<StateClaim> {
  const payload = verifyStateSignature(state, now.getTime());
  if (!payload) return { ok: false, reason: "invalid" };

  const { data, error } = await admin
    .from("highlevel_oauth_states")
    .update({ consumed_at: now.toISOString() })
    .eq("nonce", payload.nonce)
    .is("consumed_at", null)
    .gte("expires_at", now.toISOString())
    .select("nonce");

  if (error) return { ok: false, reason: "invalid" };

  const claimed = Array.isArray(data) ? data.length : 0;
  if (claimed === 0) {
    // Either it was never issued by us, or it has already been used.
    return { ok: false, reason: "already_used" };
  }

  return { ok: true, payload };
}
