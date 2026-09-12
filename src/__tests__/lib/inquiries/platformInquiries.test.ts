/**
 * The failure this module exists to prevent is not an exception. It is a form
 * that thanks someone and drops their message — which is what the showcase's
 * demonstrator form did to real visitors for months.
 *
 * So the properties pinned here are all about honesty: a success is only ever
 * reported after the row is really written, and a row is only stamped notified
 * after the email really went out.
 */

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
  hashIp,
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

  it("takes the client from the first X-Forwarded-For hop, not the proxy", () => {
    const headers = new Headers({
      "x-forwarded-for": "102.89.1.4, 10.0.0.1, 10.0.0.2",
    });
    expect(clientIpFrom(headers)).toBe("102.89.1.4");
  });

  it("falls back to X-Real-IP", () => {
    expect(clientIpFrom(new Headers({ "x-real-ip": "102.89.1.4" }))).toBe(
      "102.89.1.4",
    );
  });

  it("is null when the request carries no address at all", () => {
    expect(clientIpFrom(new Headers())).toBeNull();
  });
});
