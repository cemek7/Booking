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

const fetchWithTimeout = jest.fn();
jest.mock("@/lib/fetchWithTimeout", () => ({ fetchWithTimeout }));

import { exchangeCodeForTokens } from "@/lib/integrations/ghl/tokenExchange";

/**
 * The client secret is in this request body. The tests below check both that a
 * success is parsed correctly and that every failure path reports a reason
 * without carrying provider text — HighLevel's errors can echo what was sent.
 */

function response(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GHL_CLIENT_ID = "client-id";
  process.env.GHL_CLIENT_SECRET = "client-secret";
  process.env.GHL_REDIRECT_URI =
    "https://staging.app.techclave.cloud/api/integrations/ghl/callback";
});

afterEach(() => {
  delete process.env.GHL_CLIENT_ID;
  delete process.env.GHL_CLIENT_SECRET;
  delete process.env.GHL_REDIRECT_URI;
});

describe("exchangeCodeForTokens", () => {
  it("posts form-encoded credentials to HighLevel's token endpoint", async () => {
    fetchWithTimeout.mockResolvedValue(
      response({
        access_token: "at",
        refresh_token: "rt",
        expires_in: 86400,
        scope: "locations.readonly",
        userType: "Location",
        locationId: "loc-1",
        companyId: "co-1",
        userId: "user-1",
      }),
    );

    const result = await exchangeCodeForTokens("the-code");

    expect(result).toEqual({
      ok: true,
      tokens: {
        accessToken: "at",
        refreshToken: "rt",
        expiresInSeconds: 86400,
        scope: "locations.readonly",
        userType: "Location",
        locationId: "loc-1",
        companyId: "co-1",
        userId: "user-1",
      },
    });

    const [url, init] = fetchWithTimeout.mock.calls[0] as [
      string,
      Record<string, string>,
    ];
    expect(url).toBe("https://services.leadconnectorhq.com/oauth/token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("user_type")).toBe("Location");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("redirect_uri")).toBe(
      "https://staging.app.techclave.cloud/api/integrations/ghl/callback",
    );
  });

  it("reports a provider rejection as a status, carrying no provider text", async () => {
    fetchWithTimeout.mockResolvedValue(
      response(
        { error: "invalid_grant", error_description: "code already used" },
        {
          ok: false,
          status: 400,
        },
      ),
    );

    const result = await exchangeCodeForTokens("stale-code");

    expect(result).toEqual({ ok: false, reason: "http_error", status: 400 });
    expect(JSON.stringify(result)).not.toContain("code already used");
  });

  it("treats a 2xx without an access token as malformed", async () => {
    fetchWithTimeout.mockResolvedValue(response({ token_type: "Bearer" }));
    await expect(exchangeCodeForTokens("c")).resolves.toEqual({
      ok: false,
      reason: "malformed_response",
    });
  });

  it("treats unreadable JSON as malformed", async () => {
    fetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    });
    await expect(exchangeCodeForTokens("c")).resolves.toEqual({
      ok: false,
      reason: "malformed_response",
    });
  });

  it("reports a network failure instead of throwing into the route", async () => {
    fetchWithTimeout.mockRejectedValue(new Error("timeout"));
    await expect(exchangeCodeForTokens("c")).resolves.toEqual({
      ok: false,
      reason: "network_error",
    });
  });

  it("refuses to call out at all when the app is not configured", async () => {
    delete process.env.GHL_CLIENT_SECRET;
    await expect(exchangeCodeForTokens("c")).rejects.toThrow(
      /GHL_CLIENT_SECRET/,
    );
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });
});
