/**
 * GoHighLevel Marketplace app configuration.
 *
 * Every value is read at call time, never at import, so a build without secrets
 * still collects these routes. Nothing here returns the client secret to a
 * caller that only needs to know whether the integration is on.
 */

/** Where the user picks a sub-account and approves the app. */
export const GHL_AUTHORIZE_URL =
  "https://marketplace.gohighlevel.com/oauth/chooselocation";

/** Server-to-server code exchange. Form-encoded, per HighLevel's docs. */
export const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

/** Sub-account install. "Company" would be an agency-wide token we do not want. */
export const GHL_USER_TYPE = "Location";

export interface GhlConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
}

/**
 * Off unless explicitly enabled. The app is a private sandbox integration, so
 * production stays inert even when this code is deployed there.
 */
export function isGhlIntegrationEnabled(): boolean {
  return process.env.GHL_INTEGRATION_ENABLED === "true";
}

export class GhlNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`GoHighLevel integration is missing ${missing.join(", ")}.`);
    this.name = "GhlNotConfiguredError";
  }
}

/** Throws naming the missing variables, never their values. */
export function getGhlConfig(): GhlConfig {
  const clientId = process.env.GHL_CLIENT_ID ?? "";
  const clientSecret = process.env.GHL_CLIENT_SECRET ?? "";
  const redirectUri = process.env.GHL_REDIRECT_URI ?? "";
  // Minimum useful read-only scopes; widen only when a feature needs it.
  const scopes =
    process.env.GHL_SCOPES ?? "locations.readonly contacts.readonly";

  const missing: string[] = [];
  if (!clientId) missing.push("GHL_CLIENT_ID");
  if (!clientSecret) missing.push("GHL_CLIENT_SECRET");
  if (!redirectUri) missing.push("GHL_REDIRECT_URI");
  if (missing.length > 0) throw new GhlNotConfiguredError(missing);

  return { clientId, clientSecret, redirectUri, scopes };
}

/** The URL to send the installer to. Contains no secret: client_id is public. */
export function buildAuthorizeUrl(state: string): string {
  const { clientId, redirectUri, scopes } = getGhlConfig();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state,
  });
  return `${GHL_AUTHORIZE_URL}?${params.toString()}`;
}
