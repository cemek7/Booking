import { defaultLogger } from "@/lib/logger";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isGhlIntegrationEnabled } from "@/lib/integrations/ghl/config";
import { verifyAndClaimState } from "@/lib/integrations/ghl/oauthState";
import { exchangeCodeForTokens } from "@/lib/integrations/ghl/tokenExchange";
import { saveConnection } from "@/lib/integrations/ghl/connections";

/**
 * GET /api/integrations/ghl/callback
 *
 * Where HighLevel returns after someone installs the private app. Public by
 * necessity — HighLevel redirects a browser here with no session — so the
 * `state` is the only thing that says the flow started with us, and it is
 * signed, expiring and single-use.
 *
 * Nothing that reaches the browser or the logs contains a code, token, secret
 * or the raw query string. The page says whether it worked and nothing else.
 */

export const dynamic = "force-dynamic";

/** Plain web Response: this route returns HTML and needs nothing Next-specific. */
function page(title: string, detail: string, status: number): Response {
  const escape = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<body style="margin:0;font:16px/1.6 system-ui,sans-serif;background:#f6f5ef;color:#10211a">
  <main style="max-width:34rem;margin:12vh auto;padding:2rem;background:#fff;border:1px solid #d8d3c4;border-radius:1.5rem">
    <h1 style="margin:0 0 .75rem;font-size:1.5rem">${escape(title)}</h1>
    <p style="margin:0;color:#4f5d59">${escape(detail)}</p>
  </main>
</body>`;

  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Never let a proxy or the browser keep a page produced from a one-time code.
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!isGhlIntegrationEnabled()) {
    return page("Not available", "This integration is not enabled here.", 404);
  }

  const url = new URL(request.url);
  // Only these three are read. Anything else HighLevel appends is ignored.
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");

  if (providerError) {
    // Logged as a bare code, never the description, which can echo input.
    defaultLogger.warn("[ghl] authorization declined", {
      error: providerError,
    });
    return page(
      "Authorization was not completed",
      "HighLevel reported that the installation was declined or cancelled. You can start again from Booka.",
      400,
    );
  }

  if (!code || !state) {
    return page(
      "That link is not valid",
      "The response from HighLevel was missing required parameters. Start the installation again from Booka.",
      400,
    );
  }

  const admin = getSupabaseAdmin();

  // Claimed BEFORE the code is exchanged, so a replayed redirect cannot reach
  // HighLevel a second time.
  const claim = await verifyAndClaimState(admin, state);
  if (!claim.ok) {
    defaultLogger.warn("[ghl] state rejected", { reason: claim.reason });
    return page(
      "That link has expired",
      "This installation link was already used or is no longer valid. Start the installation again from Booka.",
      400,
    );
  }

  const exchange = await exchangeCodeForTokens(code);
  if (!exchange.ok) {
    defaultLogger.error("[ghl] token exchange failed", {
      reason: exchange.reason,
      status: exchange.status,
    });
    return page(
      "We could not finish connecting",
      "HighLevel did not complete the exchange. Nothing was saved. Please try again.",
      502,
    );
  }

  const saved = await saveConnection(admin, {
    tenantId: claim.payload.tenantId,
    tokens: exchange.tokens,
  });
  if (!saved.ok) {
    defaultLogger.error("[ghl] could not store connection");
    return page(
      "We could not finish connecting",
      "The authorization succeeded but could not be recorded. Please try again.",
      500,
    );
  }

  return page(
    "HighLevel is connected",
    "You can close this window and return to Booka.",
    200,
  );
}
