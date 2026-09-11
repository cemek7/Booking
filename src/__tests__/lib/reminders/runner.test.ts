/**
 * Reminders used to call sendTextMessage directly and mark the reservation
 * reminded regardless of what the provider said. On the Cloud API a reminder is
 * sent outside the customer's 24-hour window, where freeform text is rejected —
 * so the old code recorded a delivery for a message that never arrived.
 *
 * These tests pin the two properties that failure violated: a reminder is only
 * ever marked delivered when the send gate says it was sent, and an
 * undeliverable reminder is closed out rather than retried forever.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";

const mockGovernedSend = jest.fn();
const mockGetClient = jest.fn();
const mockRecordCampaignRun = jest.fn();

jest.mock("@/lib/whatsapp/v2/deliverability/governedSend", () => ({
  sendGovernedInitiated: mockGovernedSend,
}));
jest.mock("@/lib/whatsapp/providers/providerSelection", () => ({
  getTenantWhatsAppProviderClient: mockGetClient,
}));
jest.mock("@/lib/sias-operations", () => ({
  siasOperations: { recordCampaignRun: mockRecordCampaignRun },
}));
jest.mock("@/lib/whatsapp/v2/outboundBranding", () => ({
  brandCustomerText: jest.fn(
    async (_t: string, _p: string, text: string) => text,
  ),
}));
jest.mock("@/lib/logger", () => ({
  defaultLogger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import { runRemindersForTenant } from "@/lib/reminders/runner";

const TENANT = "tenant-1";

/** A reservation 24 hours out, so it lands in the 24h query's window. */
function reservationDue24h() {
  return {
    id: "res-1",
    customer_id: "cust-1",
    customer_number: "2348012345678",
    start_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
    service_id: "svc-1",
  };
}

interface Recorded {
  table: string;
  op: "update" | "select";
  values?: Record<string, unknown>;
  id?: string;
}

/**
 * Minimal PostgREST double. Each table returns a canned result set and every
 * update is recorded, which is what the assertions actually care about.
 */
function makeSupabase(opts: {
  reminders?: unknown[];
  due24h?: unknown[];
  due2h?: unknown[];
}) {
  const writes: Recorded[] = [];
  // reservations is queried twice with different filters, and each .from() makes
  // a fresh builder — so the counter has to live out here.
  let reservationCall = 0;

  function builder(table: string) {
    const state: {
      op: "select" | "update";
      values?: Record<string, unknown>;
      id?: string;
    } = {
      op: "select",
    };

    const rowsFor = () => {
      if (table === "reminders") return opts.reminders ?? [];
      if (table === "customers")
        return [{ id: "cust-1", customer_name: "Ada", name: null }];
      if (table === "whatsapp_conversations") return [];
      return [];
    };

    const chain: Record<string, unknown> = {};
    const self = () => chain;

    const thenable = (rows: unknown[]) =>
      Promise.resolve({ data: rows, error: null });

    Object.assign(chain, {
      update(values: Record<string, unknown>) {
        state.op = "update";
        state.values = values;
        return chain;
      },
      select() {
        if (state.op === "update") {
          writes.push({
            table,
            op: "update",
            values: state.values,
            id: state.id,
          });
          return thenable(rowsFor());
        }
        return chain;
      },
      eq(col: string, value: string) {
        if (col === "id") state.id = value;
        return self();
      },
      is: self,
      in: self,
      lte: self,
      gte: self,
      gt: self,
      limit: self,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        if (state.op === "update") {
          writes.push({
            table,
            op: "update",
            values: state.values,
            id: state.id,
          });
          return Promise.resolve({ data: null, error: null }).then(
            resolve,
            reject,
          );
        }
        let rows = rowsFor();
        if (table === "reservations") {
          rows = (reservationCall++ === 0 ? opts.due24h : opts.due2h) ?? [];
        }
        return thenable(rows).then(resolve, reject);
      },
    });

    return chain;
  }

  const client = {
    from: (table: string) => builder(table),
  } as unknown as SupabaseClient;
  return { client, writes };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetClient.mockResolvedValue({
    sendTextMessage: jest.fn(async () => ({
      success: true,
      messageId: "wamid.1",
    })),
    sendTemplateMessage: jest.fn(async () => ({
      success: true,
      messageId: "wamid.1",
    })),
  });
  mockRecordCampaignRun.mockResolvedValue(null);
});

describe("runRemindersForTenant — 24h reservation reminders", () => {
  it("marks the reservation reminded only when the send gate reports a send", async () => {
    mockGovernedSend.mockResolvedValue({
      sent: true,
      mode: "template",
      reason: "sent",
    });
    const { client, writes } = makeSupabase({ due24h: [reservationDue24h()] });

    const result = await runRemindersForTenant(client, TENANT);

    expect(result.v2_reminders_sent).toBe(1);
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: "reservations",
        values: { reminder_24h_sent: true },
        id: "res-1",
      }),
    );
    expect(mockRecordCampaignRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "sent",
        sourceEvent: "reservation.reminder_24h",
      }),
    );
  });

  it("does NOT mark the reservation reminded when the provider rejected the send", async () => {
    // The exact regression: the provider resolves with success:false rather
    // than throwing, so the old code fell through to the update.
    mockGovernedSend.mockResolvedValue({ sent: false, reason: "send_failed" });
    const { client, writes } = makeSupabase({ due24h: [reservationDue24h()] });

    const result = await runRemindersForTenant(client, TENANT);

    expect(result.v2_reminders_sent).toBe(0);
    expect(writes.filter((w) => w.table === "reservations")).toEqual([]);
    expect(mockRecordCampaignRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "retry_scheduled" }),
    );
  });

  it("closes out a reminder held for want of a template instead of retrying it forever", async () => {
    mockGovernedSend.mockResolvedValue({
      sent: false,
      reason: "no_template_outside_window",
    });
    const { client, writes } = makeSupabase({ due24h: [reservationDue24h()] });

    const result = await runRemindersForTenant(client, TENANT);

    expect(result.v2_reminders_sent).toBe(0);
    expect(result.held).toBe(1);
    // Dispositioned, so the ten-minute cron stops re-attempting it for two hours.
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: "reservations",
        values: { reminder_24h_sent: true },
      }),
    );
    expect(mockRecordCampaignRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "cancelled",
        metadata: expect.objectContaining({
          hold_reason: "no_template_outside_window",
        }),
      }),
    );
  });

  it("holds rather than sends when the customer has opted out", async () => {
    mockGovernedSend.mockResolvedValue({ sent: false, reason: "opted_out" });
    const { client } = makeSupabase({ due24h: [reservationDue24h()] });

    const result = await runRemindersForTenant(client, TENANT);

    expect(result.v2_reminders_sent).toBe(0);
    expect(result.held).toBe(1);
  });

  it("routes the reminder through the send gate rather than the provider directly", async () => {
    mockGovernedSend.mockResolvedValue({
      sent: true,
      mode: "freeform",
      reason: "sent",
    });
    const { client } = makeSupabase({ due24h: [reservationDue24h()] });

    await runRemindersForTenant(client, TENANT);

    expect(mockGovernedSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT,
        messageType: "reservation_reminder_24h",
      }),
    );
  });
});

describe("runRemindersForTenant — queued reminders table", () => {
  const queued = {
    id: "rem-1",
    reservation_id: "res-9",
    method: "whatsapp",
    raw: { to: "2348012345678", message: "See you tomorrow" },
    attempts: 0,
  };

  it("marks a queued reminder sent only on a real send", async () => {
    mockGovernedSend.mockResolvedValue({
      sent: true,
      mode: "template",
      reason: "sent",
    });
    const { client, writes } = makeSupabase({ reminders: [queued] });

    const result = await runRemindersForTenant(client, TENANT);

    expect(result.processed).toBe(1);
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: "reminders",
        values: { status: "sent" },
        id: "rem-1",
      }),
    );
  });

  it("returns a transient failure to pending so the next pass retries it", async () => {
    mockGovernedSend.mockResolvedValue({ sent: false, reason: "send_failed" });
    const { client, writes } = makeSupabase({ reminders: [queued] });

    const result = await runRemindersForTenant(client, TENANT);

    expect(result.processed).toBe(0);
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: "reminders",
        values: { attempts: 1, status: "pending" },
        id: "rem-1",
      }),
    );
  });

  it("exhausts a permanently held reminder and keeps the reason on the row", async () => {
    mockGovernedSend.mockResolvedValue({
      sent: false,
      reason: "no_template_outside_window",
    });
    const { client, writes } = makeSupabase({ reminders: [queued] });

    const result = await runRemindersForTenant(client, TENANT);

    expect(result.held).toBe(1);
    const write = writes.find(
      (w) => w.table === "reminders" && w.id === "rem-1",
    );
    expect(write?.values).toEqual(
      expect.objectContaining({
        status: "failed",
        attempts: 5,
        raw: expect.objectContaining({
          hold_reason: "no_template_outside_window",
        }),
      }),
    );
  });

  it("returns a thrown send to pending rather than stranding the claimed row", async () => {
    // The row is already at status 'processing'; the claim query only picks up
    // 'pending', so an escaping exception would hide it forever.
    mockGovernedSend.mockRejectedValue(new Error("graph api exploded"));
    const { client, writes } = makeSupabase({ reminders: [queued] });

    const result = await runRemindersForTenant(client, TENANT);

    expect(result.processed).toBe(0);
    expect(result.held).toBe(0);
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: "reminders",
        values: { attempts: 1, status: "pending" },
        id: "rem-1",
      }),
    );
  });

  it("does not send at all when the tenant has no WhatsApp provider", async () => {
    mockGetClient.mockResolvedValue(null);
    const { client } = makeSupabase({
      reminders: [queued],
      due24h: [reservationDue24h()],
    });

    const result = await runRemindersForTenant(client, TENANT);

    expect(mockGovernedSend).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
    expect(result.v2_reminders_sent).toBe(0);
  });
});
