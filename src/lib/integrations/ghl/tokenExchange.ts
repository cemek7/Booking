import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { GHL_TOKEN_URL, GHL_USER_TYPE, getGhlConfig } from "./config";

/**
 * Exchanges an authorization code for tokens, server side only.
 *
 * The client secret goes in this request body and nowhere else. Nothing in this
 * module logs the request or the response: a failure reports the HTTP status
 * and nothing more, because HighLevel's error bodies can echo request fields.
 */

export interface GhlTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number | null;
  scope: string | null;
  userType: string | null;
  locationId: string | null;
  companyId: string | null;
  userId: string | null;
}

export type TokenExchangeResult =
  | { ok: true; tokens: GhlTokens }
  | {
      ok: false;
      reason: "http_error" | "malformed_response" | "network_error";
      status?: number;
    };

export async function exchangeCodeForTokens(
  code: string,
): Promise<TokenExchangeResult> {
  const { clientId, clientSecret, redirectUri } = getGhlConfig();

  // HighLevel's token endpoint takes form encoding, not JSON.
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    user_type: GHL_USER_TYPE,
    redirect_uri: redirectUri,
  });

  let response: Response;
  try {
    response = await fetchWithTimeout(GHL_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      timeoutMs: 15_000,
    });
  } catch {
    return { ok: false, reason: "network_error" };
  }

  if (!response.ok) {
    return { ok: false, reason: "http_error", status: response.status };
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "malformed_response" };
  }

  const accessToken =
    typeof payload.access_token === "string" ? payload.access_token : "";
  if (!accessToken) return { ok: false, reason: "malformed_response" };

  const str = (value: unknown) =>
    typeof value === "string" && value ? value : null;

  return {
    ok: true,
    tokens: {
      accessToken,
      refreshToken: str(payload.refresh_token),
      expiresInSeconds:
        typeof payload.expires_in === "number" ? payload.expires_in : null,
      scope: str(payload.scope),
      userType: str(payload.userType),
      locationId: str(payload.locationId),
      companyId: str(payload.companyId),
      userId: str(payload.userId),
    },
  };
}
