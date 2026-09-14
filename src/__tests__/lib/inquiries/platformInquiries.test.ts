/**
 * The failure this module exists to prevent is not an exception. It is a form
 * that thanks someone and drops their message — which is what the showcase's
 * demonstrator form did to real visitors for months.
 *
 * So the properties pinned here are all about honesty: a success is only ever
 * reported after the row is really written, and a row is only stamped notified
 * after the email really went out.
 */

import { createHash } from "crypto";
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";

const mockSendTransactionalEmail = jest.fn();

jest.mock("@/lib/integrations/email-service", () => ({
  sendTransactionalEmail: mockSendTransactionalEmail,
}));
jest.mock("@/lib/logger", () => ({
  defaultLogger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import {
  clientIpFrom,
  countUnnotifiedInquiries,
  hashIp,
  publicContactEmail,
  RATE_LIMIT_MAX,
  submitInquiry,
} from "@/lib/inquiries/platformInquiries";

const VALID = {
  name: "Ada Okafor",
  email: "ada@glowstudio.ng",
  company: "Glow Studio",
  phone: "08012345678",
  interest: "Booka for my business",
  message: "We lose bookings because nobody answers WhatsApp after 6pm.",
};

interface Harness {
  admin: SupabaseClient;
  inserted: Array<Record<string, unknown>>;
  updated: Array<Record<string, unknown>>;
}

function makeAdmin(
  opts: { recentCount?: number; insertFails?: boolean } = {},
): Harness {
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];

  const admin = {
    from() {
      const chain: Record<string, unknown> = {};
      let mode: "count" | "insert" | "update" = "count";

      Object.assign(chain, {
        select(_cols: string, options?: { count?: string; head?: boolean }) {
          if (options?.head) {
            mode = "count";
            return chain;
          }
          // insert(...).select('id')
          return chain;
        },
        insert(values: Record<string, unknown>) {
          mode = "insert";
          inserted.push(values);
          return chain;
        },
        update(values: Record<string, unknown>) {
          mode = "update";
          updated.push(values);
          return chain;
        },
        eq: () => chain,
        is: () => chain,
        gte: () => chain,
        maybeSingle: () =>
          Promise.resolve(
            opts.insertFails
              ? { data: null, error: { message: "insert denied" } }
              : { data: { id: "inq-1" }, error: null },
          ),
        then(resolve: (v: unknown) => unknown) {
          if (mode === "count") {
            return Promise.resolve({
              count: opts.recentCount ?? 0,
              error: null,
            }).then(resolve);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      });

      return chain;
    },
  } as unknown as SupabaseClient;

  return { admin, inserted, updated };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TECHCLAVE_INQUIRY_EMAIL = "hello@techclave.example";
  mockSendTransactionalEmail.mockResolvedValue({
    success: true,
    messageId: "m1",
  });
});

describe("submitInquiry", () => {
  it("stores the inquiry and emails a human", async () => {
    const { admin, inserted, updated } = makeAdmin();

    const result = await submitInquiry(admin, VALID);

    expect(result).toEqual({ ok: true, id: "inq-1" });
    expect(inserted[0]).toEqual(
      expect.objectContaining({
        name: "Ada Okafor",
        email: "ada@glowstudio.ng",
      }),
    );
    expect(mockSendTransactionalEmail).toHaveBeenCalledWith(
      // Replying in the inbox must answer the person, not the mailer.
      expect.objectContaining({
        to: "hello@techclave.example",
        replyTo: "ada@glowstudio.ng",
      }),
    );
    expect(updated[0]).toEqual(
      expect.objectContaining({ notified_at: expect.any(String) }),
    );
  });

  it("does not report success when the row was never written", async () => {
    // supabase-js resolves with an error rather than throwing, so a try/catch
    // would have caught nothing and the visitor would have been thanked.
    const { admin, updated } = makeAdmin({ insertFails: true });

    const result = await submitInquiry(admin, VALID);

    expect(result).toEqual(expect.objectContaining({ ok: false, status: 500 }));
    expect(mockSendTransactionalEmail).not.toHaveBeenCalled();
    expect(updated).toEqual([]);
  });

  it("leaves the row unstamped when the notification email fails", async () => {
    mockSendTransactionalEmail.mockResolvedValue({
      success: false,
      error: "no api key",
    });
    const { admin, updated } = makeAdmin();

    const result = await submitInquiry(admin, VALID);

    // The message IS stored, so the visitor is not asked to retype it. The
    // unstamped row is what the superadmin alert reads.
    expect(result).toEqual({ ok: true, id: "inq-1" });
    expect(updated).toEqual([]);
  });

  it("still reports success when the email provider throws after the row is stored", async () => {
    // The sender throws on a Resend rejection (daily cap, unverified domain).
    // The message is safely stored, so the visitor must not be told to retry,
    // and the row stays unstamped for the superadmin alert.
    mockSendTransactionalEmail.mockRejectedValue(
      new Error("Resend API error (429)"),
    );
    const { admin, inserted, updated } = makeAdmin();

    const result = await submitInquiry(admin, VALID);

    expect(result).toEqual({ ok: true, id: "inq-1" });
    expect(inserted).toHaveLength(1);
    expect(updated).toEqual([]);
  });

  it("stores the inquiry even with no recipient configured", async () => {
    delete process.env.TECHCLAVE_INQUIRY_EMAIL;
    const { admin, inserted } = makeAdmin();

    const result = await submitInquiry(admin, VALID);

    expect(result).toEqual({ ok: true, id: "inq-1" });
    expect(inserted).toHaveLength(1);
    expect(mockSendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("rejects a message too short to act on, naming the field", async () => {
    const { admin, inserted } = makeAdmin();

    const result = await submitInquiry(admin, { ...VALID, message: "hi" });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        fields: expect.objectContaining({ message: expect.any(String) }),
      }),
    );
    expect(inserted).toEqual([]);
  });

  it("rejects an unusable email address", async () => {
    const { admin } = makeAdmin();
    const result = await submitInquiry(admin, {
      ...VALID,
      email: "not-an-email",
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 400 }));
  });

  it("silently discards a honeypot submission without storing or emailing", async () => {
    const { admin, inserted } = makeAdmin();

    const result = await submitInquiry(admin, {
      ...VALID,
      website: "http://spam.example",
    });

    // Looks like a success so the bot stops probing; nothing is kept.
    expect(result).toEqual({ ok: true, id: null, discarded: true });
    expect(inserted).toEqual([]);
    expect(mockSendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("refuses a flood from one address", async () => {
    const { admin, inserted } = makeAdmin({ recentCount: RATE_LIMIT_MAX });

    const result = await submitInquiry(admin, VALID, {
      ipHash: "abc",
      userAgent: null,
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, status: 429 }));
    expect(inserted).toEqual([]);
  });

  it("does not rate-limit when no IP could be determined", async () => {
    const { admin, inserted } = makeAdmin({ recentCount: 999 });

    const result = await submitInquiry(admin, VALID, {
      ipHash: null,
      userAgent: null,
    });

    expect(result).toEqual({ ok: true, id: "inq-1" });
    expect(inserted).toHaveLength(1);
  });
});

describe("IP handling", () => {
  it("never stores a raw address", () => {
    const hash = hashIp("102.89.1.4");
    expect(hash).not.toContain("102.89.1.4");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns null rather than hashing nothing", () => {
    expect(hashIp(null)).toBeNull();
    expect(hashIp("")).toBeNull();
  });

  it("is salted even when no dedicated salt is configured", () => {
    const savedSalt = process.env.INQUIRY_IP_SALT;
    const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.INQUIRY_IP_SALT;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    const unsalted = createHash("sha256").update(":102.89.1.4").digest("hex");
    // An unsalted IPv4 hash is reversible by enumerating the address space.
    expect(hashIp("102.89.1.4")).not.toBe(unsalted);
    if (savedSalt === undefined) delete process.env.INQUIRY_IP_SALT;
    else process.env.INQUIRY_IP_SALT = savedSalt;
    if (savedKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  });

  it("uses the address our nginx saw, not the first X-Forwarded-For hop", () => {
    // The first hop is whatever the client sent. Trusting it would let anyone
    // dodge the rate limit with a fresh made-up header on every request.
    const headers = new Headers({
      "x-forwarded-for": "6.6.6.6, 102.89.1.4",
      "x-real-ip": "102.89.1.4",
    });
    expect(clientIpFrom(headers)).toBe("102.89.1.4");
  });

  it("falls back to the last X-Forwarded-For hop, which nginx appended", () => {
    const headers = new Headers({ "x-forwarded-for": "6.6.6.6, 102.89.1.4" });
    expect(clientIpFrom(headers)).toBe("102.89.1.4");
  });

  it("uses CF-Connecting-IP when the request really came through Cloudflare", () => {
    // Otherwise every visitor behind one Cloudflare edge shares a rate limit.
    const headers = new Headers({
      "x-real-ip": "172.70.10.20",
      "cf-connecting-ip": "102.89.1.4",
    });
    expect(clientIpFrom(headers)).toBe("102.89.1.4");
  });

  it("ignores a forged CF-Connecting-IP on a request that bypassed Cloudflare", () => {
    const headers = new Headers({
      "x-real-ip": "102.89.1.4",
      "cf-connecting-ip": "1.2.3.4",
    });
    expect(clientIpFrom(headers)).toBe("102.89.1.4");
  });

  it("recognises Cloudflare's IPv6 edges too", () => {
    const headers = new Headers({
      "x-real-ip": "2606:4700:10::6816:1",
      "cf-connecting-ip": "2c0f:2a80::1",
    });
    expect(clientIpFrom(headers)).toBe("2c0f:2a80::1");
  });

  it("rejects header values that are not addresses", () => {
    expect(clientIpFrom(new Headers({ "x-real-ip": "not-an-ip" }))).toBeNull();
  });

  it("is null when the request carries no address at all", () => {
    expect(clientIpFrom(new Headers())).toBeNull();
  });
});

describe("countUnnotifiedInquiries", () => {
  function countingAdmin(result: {
    count?: number;
    error?: { code: string } | null;
  }) {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain,
      is: () => chain,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          count: result.count ?? null,
          error: result.error ?? null,
        }).then(resolve),
    });
    return { from: () => chain } as unknown as SupabaseClient;
  }

  it("reports the table missing rather than a reassuring zero", async () => {
    await expect(
      countUnnotifiedInquiries(countingAdmin({ error: { code: "PGRST205" } })),
    ).resolves.toEqual({ count: 0, tableMissing: true });
  });

  it("treats other read errors as transient", async () => {
    await expect(
      countUnnotifiedInquiries(countingAdmin({ error: { code: "57014" } })),
    ).resolves.toEqual({ count: 0, tableMissing: false });
  });

  it("returns the count when the read succeeds", async () => {
    await expect(
      countUnnotifiedInquiries(countingAdmin({ count: 4 })),
    ).resolves.toEqual({
      count: 4,
      tableMissing: false,
    });
  });
});

describe("publicContactEmail", () => {
  const saved = process.env.TECHCLAVE_CONTACT_EMAIL;

  afterEach(() => {
    if (saved === undefined) delete process.env.TECHCLAVE_CONTACT_EMAIL;
    else process.env.TECHCLAVE_CONTACT_EMAIL = saved;
  });

  it("prefers the published alias over the notification inbox", () => {
    process.env.TECHCLAVE_CONTACT_EMAIL = "hello@techclave.cloud";
    process.env.TECHCLAVE_INQUIRY_EMAIL = "private@example.com";
    expect(publicContactEmail()).toBe("hello@techclave.cloud");
  });

  it("falls back to the notification inbox when they are the same address", () => {
    delete process.env.TECHCLAVE_CONTACT_EMAIL;
    process.env.TECHCLAVE_INQUIRY_EMAIL = "hello@techclave.cloud";
    expect(publicContactEmail()).toBe("hello@techclave.cloud");
  });

  it("is null when neither is configured, so no dead address is printed", () => {
    delete process.env.TECHCLAVE_CONTACT_EMAIL;
    delete process.env.TECHCLAVE_INQUIRY_EMAIL;
    expect(publicContactEmail()).toBeNull();
  });
});
