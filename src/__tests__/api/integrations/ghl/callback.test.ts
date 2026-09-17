/**
 * @jest-environment node
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

/**
 * The callback is public: HighLevel redirects a browser to it with no session.
 * These tests pin what it accepts, what it refuses, and what it is willing to
 * say out loud — a code, token or secret must never reach the page or the log.
 */

const verifyAndClaimState = jest.fn();
const exchangeCodeForTokens = jest.fn();
const saveConnection = jest.fn();
const getSupabaseAdmin = jest.fn(() => ({}) as never);
const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };

jest.mock("@/lib/integrations/ghl/oauthState", () => ({ verifyAndClaimState }));
jest.mock("@/lib/integrations/ghl/tokenExchange", () => ({
  exchangeCodeForTokens,
}));
jest.mock("@/lib/integrations/ghl/connections", () => ({ saveConnection }));
jest.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin }));
jest.mock("@/lib/logger", () => ({ defaultLogger: logger }));

import { GET } from "@/app/api/integrations/ghl/callback/route";

const BASE =
  "https://staging.app.techclave.cloud/api/integrations/ghl/callback";

const TOKENS = {
  accessToken: "super-secret-access-token",
  refreshToken: "super-secret-refresh-token",
  expiresInSeconds: 86400,
  scope: "locations.readonly",
  userType: "Location",
  locationId: "loc-1",
  companyId: "co-1",
  userId: "user-1",
};

function request(query: string) {
  return new Request(`${BASE}${query}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GHL_INTEGRATION_ENABLED = "true";
  verifyAndClaimState.mockResolvedValue({
    ok: true,
    payload: { nonce: "n", tenantId: "t1" },
  });
  exchangeCodeForTokens.mockResolvedValue({ ok: true, tokens: TOKENS });
  saveConnection.mockResolvedValue({ ok: true });
});

afterEach(() => {
  delete process.env.GHL_INTEGRATION_ENABLED;
});

describe("GET /api/integrations/ghl/callback", () => {
  it("stores the connection and says so, without printing anything secret", async () => {
    const response = await GET(request("?code=the-code&state=signed-state"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("HighLevel is connected");
    expect(body).not.toContain(TOKENS.accessToken);
    expect(body).not.toContain(TOKENS.refreshToken);
    expect(body).not.toContain("the-code");
    expect(body).not.toContain("signed-state");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");

    expect(saveConnection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: "t1", tokens: TOKENS }),
    );
  });

  it("claims the state before exchanging the code, so a replay cannot reach HighLevel", async () => {
    verifyAndClaimState.mockResolvedValue({
      ok: false,
      reason: "already_used",
    });

    const response = await GET(request("?code=the-code&state=replayed"));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("expired");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(saveConnection).not.toHaveBeenCalled();
  });

  it("refuses an invalid state", async () => {
    verifyAndClaimState.mockResolvedValue({ ok: false, reason: "invalid" });
    const response = await GET(request("?code=c&state=forged"));
    expect(response.status).toBe(400);
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("reports a declined authorization and never calls the token endpoint", async () => {
    const response = await GET(
      request("?error=access_denied&error_description=User+said+no"),
    );
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain("not completed");
    // The provider's free text is never echoed back to the browser.
    expect(body).not.toContain("User said no");
    expect(verifyAndClaimState).not.toHaveBeenCalled();
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("rejects a request with no code or state", async () => {
    const response = await GET(request(""));
    expect(response.status).toBe(400);
    expect(verifyAndClaimState).not.toHaveBeenCalled();
  });

  it("saves nothing when the exchange fails, and does not leak the reason to the page", async () => {
    exchangeCodeForTokens.mockResolvedValue({
      ok: false,
      reason: "http_error",
      status: 401,
    });

    const response = await GET(request("?code=c&state=s"));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toContain("Nothing was saved");
    expect(body).not.toContain("401");
    expect(saveConnection).not.toHaveBeenCalled();
  });

  it("reports a storage failure rather than claiming success", async () => {
    saveConnection.mockResolvedValue({ ok: false });
    const response = await GET(request("?code=c&state=s"));
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("could not be recorded");
  });

  it("is invisible unless the integration is switched on", async () => {
    delete process.env.GHL_INTEGRATION_ENABLED;
    const response = await GET(request("?code=c&state=s"));

    expect(response.status).toBe(404);
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
    expect(verifyAndClaimState).not.toHaveBeenCalled();
  });

  it("never writes a code, state or token to the log", async () => {
    exchangeCodeForTokens.mockResolvedValue({
      ok: false,
      reason: "http_error",
      status: 400,
    });
    await GET(request("?code=the-code&state=signed-state"));

    const logged = JSON.stringify([
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(logged).not.toContain("the-code");
    expect(logged).not.toContain("signed-state");
    expect(logged).not.toContain(TOKENS.accessToken);
  });
});
