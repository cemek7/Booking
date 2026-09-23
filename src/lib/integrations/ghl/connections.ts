import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decryptMetaCredential,
  encryptMetaCredential,
} from "@/lib/whatsapp/metaCredentialCrypto";
import type { GhlTokens } from "./tokenExchange";

/**
 * Stores a HighLevel installation.
 *
 * Tokens are encrypted with the platform's existing AES-256-GCM helper, under
 * the server-only ENCRYPTION_KEY, so there is one key-management scheme rather
 * than a second one invented here. A plaintext token never reaches a column.
 */

export async function saveConnection(
  admin: SupabaseClient,
  input: { tenantId: string | null; tokens: GhlTokens; now?: Date },
): Promise<{ ok: boolean }> {
  const now = input.now ?? new Date();
  const access = encryptMetaCredential(input.tokens.accessToken);
  const refresh = input.tokens.refreshToken
    ? encryptMetaCredential(input.tokens.refreshToken)
    : null;

  const expiresAt = input.tokens.expiresInSeconds
    ? new Date(
        now.getTime() + input.tokens.expiresInSeconds * 1000,
      ).toISOString()
    : null;

  const row = {
    tenant_id: input.tenantId,
    location_id: input.tokens.locationId,
    company_id: input.tokens.companyId,
    user_type: input.tokens.userType,
    ghl_user_id: input.tokens.userId,
    scope: input.tokens.scope,
    encrypted_access_token: access.encryptedApiKey,
    access_token_iv: access.encryptionIv,
    encrypted_refresh_token: refresh?.encryptedApiKey ?? null,
    refresh_token_iv: refresh?.encryptionIv ?? null,
    encryption_key_version: access.encryptionKeyVersion,
    token_expires_at: expiresAt,
    updated_at: now.toISOString(),
    revoked_at: null,
  };

  // Re-installing the same location replaces its credentials rather than
  // accumulating rows, which is what the unique index on location_id expects.
  const { error } = input.tokens.locationId
    ? await admin
        .from("highlevel_oauth_connections")
        .upsert(row, { onConflict: "location_id" })
    : await admin.from("highlevel_oauth_connections").insert(row);

  // supabase-js resolves with an error rather than throwing.
  if (error) return { ok: false };
  return { ok: true };
}

/** Reads a stored access token back. Server-side callers only. */
export async function readAccessToken(
  admin: SupabaseClient,
  locationId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("highlevel_oauth_connections")
    .select(
      "encrypted_access_token, access_token_iv, encryption_key_version, revoked_at",
    )
    .eq("location_id", locationId)
    .maybeSingle();

  if (error || !data || data.revoked_at) return null;

  try {
    return decryptMetaCredential({
      encryptedApiKey: data.encrypted_access_token as string,
      encryptionIv: data.access_token_iv as string,
      encryptionKeyVersion: data.encryption_key_version as string,
    });
  } catch {
    return null;
  }
}
