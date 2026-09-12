import { describe, it, expect } from "@jest/globals";
import { buildPlatformAlerts, daysBetween } from "@/lib/billing/platformAlerts";

/**
 * Every alert here describes something that breaks nothing and throws nothing.
 * The severity rules are the whole product: if the Meta payment deadline is
 * ranked the same as a stale FX reading, the important one gets scrolled past.
 */

const BASE = {
  rateCard: [],
  meteringMode: "shadow" as const,
  rateConfigured: true,
  paymentMethodOnFile: true,
  gatewayPhoneSet: true,
  meteredMessageCount: 42,
  missingTemplateTypes: [] as string[],
  unnotifiedInquiries: 0,
  inquiryRecipientSet: true,
  now: new Date("2026-09-08T00:00:00Z"),
};

describe("buildPlatformAlerts", () => {
  it("is silent when everything is in order", () => {
    expect(buildPlatformAlerts(BASE)).toEqual([]);
  });

  it("raises the Meta payment method, and escalates inside two weeks", () => {
    const far = buildPlatformAlerts({
      ...BASE,
      paymentMethodOnFile: false,
      now: new Date("2026-09-01T00:00:00Z"),
    });
    expect(far[0].severity).toBe("warning");

    const near = buildPlatformAlerts({
      ...BASE,
      paymentMethodOnFile: false,
      now: new Date("2026-09-25T00:00:00Z"),
    });
    // Every tenant goes silent at once if this is missed; it must outrank drift.
    expect(near[0].severity).toBe("critical");
    expect(near[0].title).toContain("day");
  });

  it("says overdue rather than counting down past the deadline", () => {
    const [alert] = buildPlatformAlerts({
      ...BASE,
      paymentMethodOnFile: false,
      now: new Date("2026-10-05T00:00:00Z"),
    });
    expect(alert.severity).toBe("critical");
    expect(alert.title).toContain("overdue");
    expect(alert.message).toContain("already");
  });

  it("is critical when still in shadow mode after the cutover", () => {
    const alerts = buildPlatformAlerts({
      ...BASE,
      meteringMode: "shadow",
      now: new Date("2026-10-02T00:00:00Z"),
    });
    const a = alerts.find((x) => x.id === "metering_shadow_after_cutover");
    expect(a?.severity).toBe("critical");
    // Absorbed cost is the point: it is not "not working yet", it is money.
    expect(a?.message).toContain("absorbed");
  });

  it("does not nag about shadow mode before the cutover", () => {
    const alerts = buildPlatformAlerts({ ...BASE, meteringMode: "shadow" });
    expect(
      alerts.find((x) => x.id === "metering_shadow_after_cutover"),
    ).toBeUndefined();
  });

  it("flags live metering running on the fallback rate", () => {
    const alerts = buildPlatformAlerts({
      ...BASE,
      meteringMode: "live",
      rateConfigured: false,
      now: new Date("2026-10-02T00:00:00Z"),
    });
    expect(alerts.some((x) => x.id === "metering_live_no_rate")).toBe(true);
  });

  it("passes rate-card warnings through with a usable title", () => {
    const alerts = buildPlatformAlerts({
      ...BASE,
      rateCard: [
        {
          kind: "quarter_unconfirmed",
          effectiveOn: "2027-01-01",
          message: "nothing dated for the next quarter",
        },
      ],
    });
    const a = alerts.find((x) => x.id === "rate_card_quarter_unconfirmed");
    expect(a?.title).toContain("2027-01-01");
    expect(a?.action).toContain("message_rate_card");
  });

  it("sorts critical above warning so the worst thing is read first", () => {
    const alerts = buildPlatformAlerts({
      ...BASE,
      paymentMethodOnFile: false,
      now: new Date("2026-09-25T00:00:00Z"),
      rateCard: [{ kind: "fx_stale", message: "stale" }],
    });
    expect(alerts.map((a) => a.severity)).toEqual(["critical", "warning"]);
  });
});

describe("daysBetween", () => {
  it("counts forward and goes negative once the date has passed", () => {
    expect(
      daysBetween(
        new Date("2026-09-08T00:00:00Z"),
        new Date("2026-09-30T00:00:00Z"),
      ),
    ).toBe(22);
    expect(
      daysBetween(
        new Date("2026-10-05T00:00:00Z"),
        new Date("2026-09-30T00:00:00Z"),
      ),
    ).toBeLessThan(0);
  });
});

describe("gateway phone", () => {
  it("warns when it is unset, because activation still succeeds without it", () => {
    // The Evolution-era fallback was removed, so an unset variable now means
    // every chat-onboarded tenant gets no booking link and nothing else says so.
    const alerts = buildPlatformAlerts({ ...BASE, gatewayPhoneSet: false });
    const a = alerts.find((x) => x.id === "gateway_phone_missing");
    expect(a).toBeDefined();
    expect(a!.action).toContain("BOOKA_GATEWAY_PHONE");
  });

  it("is silent once it is set", () => {
    expect(buildPlatformAlerts({ ...BASE, gatewayPhoneSet: true })).toEqual([]);
  });
});

describe("metering actually recording", () => {
  it("warns before the cutover when nothing has been recorded", () => {
    // Shadow mode should be filling this table now. Empty means either no
    // traffic yet, or metering is not attached to the send path at all — and it
    // will not start working on 1 October by itself.
    const alerts = buildPlatformAlerts({ ...BASE, meteredMessageCount: 0 });
    const a = alerts.find((x) => x.id === "metering_recorded_nothing");
    expect(a?.severity).toBe("warning");
    expect(a?.message).toContain("not attached to the send path");
  });

  it("is CRITICAL once the cutover has passed with an empty table", () => {
    // After the cutover, silence is money: Meta bills Booka for every message
    // and nothing is charged back, and the first symptom is an invoice.
    const alerts = buildPlatformAlerts({
      ...BASE,
      meteredMessageCount: 0,
      now: new Date("2026-10-03T00:00:00Z"),
      meteringMode: "live",
    });
    const a = alerts.find((x) => x.id === "metering_recorded_nothing");
    expect(a?.severity).toBe("critical");
    expect(a?.action).toContain("webhook");
  });

  it("is silent as soon as anything has been recorded", () => {
    expect(
      buildPlatformAlerts({ ...BASE, meteredMessageCount: 1 }).find(
        (x) => x.id === "metering_recorded_nothing",
      ),
    ).toBeUndefined();
  });

  it("is critical when an out-of-window message type has no approved template", () => {
    const alerts = buildPlatformAlerts({
      ...BASE,
      missingTemplateTypes: ["reservation_reminder_24h", "payment_receipt"],
    });
    const a = alerts.find((x) => x.id === "out_of_window_templates_missing");
    // A held reminder looks identical to a delivered one from the outside.
    expect(a?.severity).toBe("critical");
    expect(a?.title).toContain("2 message types");
    expect(a?.message).toContain("reservation_reminder_24h");
    expect(a?.message).toContain("payment_receipt");
  });

  it('says "message type" in the singular for one missing template', () => {
    const [a] = buildPlatformAlerts({
      ...BASE,
      missingTemplateTypes: ["waitlist_slot"],
    });
    expect(a.title).toContain("1 message type");
    expect(a.title).not.toContain("types");
  });

  it("is critical when an inquiry arrived and nobody was told", () => {
    const alerts = buildPlatformAlerts({ ...BASE, unnotifiedInquiries: 3 });
    const a = alerts.find((x) => x.id === "inquiries_unnotified");
    // Someone asked to talk to us and is waiting on a reply nobody knows to write.
    expect(a?.severity).toBe("critical");
    expect(a?.title).toContain("3");
  });

  it("warns before the first inquiry when no recipient is configured", () => {
    const [a] = buildPlatformAlerts({ ...BASE, inquiryRecipientSet: false });
    expect(a.id).toBe("inquiry_recipient_missing");
    // Nothing is lost yet, so this is a warning — but it says what will happen.
    expect(a.severity).toBe("warning");
    expect(a.message).toContain("unseen");
  });

  it("escalates the missing recipient once inquiries are actually waiting", () => {
    const [a] = buildPlatformAlerts({
      ...BASE,
      inquiryRecipientSet: false,
      unnotifiedInquiries: 2,
    });
    expect(a.id).toBe("inquiry_recipient_missing");
    expect(a.severity).toBe("critical");
    expect(a.message).toContain("2 inquiries are");
  });
});
