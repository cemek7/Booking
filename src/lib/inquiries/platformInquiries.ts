import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { defaultLogger } from "@/lib/logger";
import { sendTransactionalEmail } from "@/lib/integrations/email-service";

/**
 * Inbound inquiries to Techclave itself.
 *
 * The failure this guards against is not a crash. It is an inquiry that is
 * accepted, thanked, and then seen by nobody — which is what the showcase's
 * demonstrator form did for real visitors. So the database write is the
 * commitment: if it fails the submitter is told, and if the notification email
 * fails the row is left unstamped so the superadmin dashboard can say so.
 */

export const INQUIRY_SOURCE = "techclave_contact";

/** How many submissions one address may make per window before being refused. */
export const RATE_LIMIT_MAX = 5;
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export const inquirySchema = z.object({
  name: z.string().trim().min(2, "Tell us your name.").max(120),
  email: z.string().trim().email("Enter an email we can reply to.").max(200),
  company: z.string().trim().max(160).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  interest: z.string().trim().max(120).optional().or(z.literal("")),
  message: z
    .string()
    .trim()
    .min(20, "A sentence or two about what you need.")
    .max(4000),
  /**
   * Honeypot. Real people never see this field, so anything in it is a bot.
   * The submission is accepted and discarded rather than refused, because a
   * visible rejection just tells the bot which field to leave alone.
   */
  website: z.string().max(200).optional(),
});

export type InquiryInput = z.infer<typeof inquirySchema>;

export type InquiryResult =
  | { ok: true; id: string | null; discarded?: boolean }
  | {
      ok: false;
      status: number;
      error: string;
      fields?: Record<string, string>;
    };

/**
 * IP is needed to throttle a flood and for nothing else, so only a salted hash
 * is kept. Without a salt the hash of an IPv4 address is trivially reversible —
 * the whole space is four billion entries.
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const salt = process.env.INQUIRY_IP_SALT ?? process.env.NEXTAUTH_SECRET ?? "";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/** First hop in X-Forwarded-For is the client; the rest are proxies. */
export function clientIpFrom(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip");
}

/**
 * Counted in the database rather than in memory. The process restarts on every
 * deploy, and an in-memory counter would reset with it — which is exactly when
 * a flood would be underway.
 */
export async function isRateLimited(
  admin: SupabaseClient,
  ipHash: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  if (!ipHash) return false;

  const since = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error } = await admin
    .from("platform_inquiries")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);

  // Fail open: a read error must not silence the contact form, which is the
  // only way anyone can reach us.
  if (error) {
    defaultLogger.warn("[inquiries] rate-limit check failed", error);
    return false;
  }

  return (count ?? 0) >= RATE_LIMIT_MAX;
}

function inquiryEmailHtml(input: InquiryInput, id: string | null): string {
  const rows: Array<[string, string]> = [
    ["Name", input.name],
    ["Email", input.email],
    ["Company", input.company || "—"],
    ["Phone", input.phone || "—"],
    ["Interested in", input.interest || "—"],
  ];

  // Everything here is attacker-controlled text going into HTML.
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  return [
    "<h2>New Techclave inquiry</h2>",
    "<table cellpadding='6' style='border-collapse:collapse'>",
    ...rows.map(
      ([k, v]) =>
        `<tr><td style="color:#5a625f">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`,
    ),
    "</table>",
    `<p style="white-space:pre-wrap">${esc(input.message)}</p>`,
    id ? `<p style="color:#8a8f8c;font-size:12px">Inquiry ${esc(id)}</p>` : "",
  ].join("");
}

/** Where inquiry notifications go. Without it nobody is told. */
export function inquiryRecipient(): string | null {
  return process.env.TECHCLAVE_INQUIRY_EMAIL ?? null;
}

/**
 * The address printed on the contact page, for people who would rather write
 * than fill in a form.
 *
 * Kept separate from the notification recipient because the two can legitimately
 * differ: the published address is a routed alias, while alerts may land in a
 * private inbox. It falls back to the recipient because in the common case they
 * are the same address, and renders nothing when neither is set — an email
 * address printed on a page that nobody receives is worse than none.
 */
export function publicContactEmail(): string | null {
  return process.env.TECHCLAVE_CONTACT_EMAIL ?? inquiryRecipient();
}

/**
 * Validate, store, and announce one inquiry.
 *
 * `admin` must be a service-role client: platform_inquiries has RLS enabled
 * with no policies, so nothing else can write to it.
 */
export async function submitInquiry(
  admin: SupabaseClient,
  raw: unknown,
  meta: { ipHash: string | null; userAgent: string | null } = {
    ipHash: null,
    userAgent: null,
  },
): Promise<InquiryResult> {
  const parsed = inquirySchema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fields[key]) fields[key] = issue.message;
    }
    return { ok: false, status: 400, error: "Please check the form.", fields };
  }

  const input = parsed.data;

  // Honeypot: look like a success so the bot stops trying, but store nothing.
  if (input.website && input.website.trim().length > 0) {
    return { ok: true, id: null, discarded: true };
  }

  if (await isRateLimited(admin, meta.ipHash)) {
    return {
      ok: false,
      status: 429,
      error: "That is a lot of messages. Email us directly and we will reply.",
    };
  }

  const { data, error } = await admin
    .from("platform_inquiries")
    .insert({
      name: input.name,
      email: input.email,
      company: input.company || null,
      phone: input.phone || null,
      interest: input.interest || null,
      message: input.message,
      source: INQUIRY_SOURCE,
      ip_hash: meta.ipHash,
      user_agent: meta.userAgent?.slice(0, 500) ?? null,
    })
    .select("id")
    .maybeSingle();

  // supabase-js resolves with an error rather than throwing, so this has to be
  // read. Telling someone their message was sent when it was not is the exact
  // failure this whole route exists to stop.
  if (error || !data) {
    defaultLogger.error("[inquiries] could not store inquiry", error);
    return {
      ok: false,
      status: 500,
      error: "We could not record that. Please try again shortly.",
    };
  }

  const id = data.id as string;
  const to = inquiryRecipient();

  if (to) {
    const sent = await sendTransactionalEmail({
      to,
      subject: `Techclave inquiry — ${input.name}${input.company ? ` (${input.company})` : ""}`,
      html: inquiryEmailHtml(input, id),
      // So hitting reply in the inbox answers the person, not the mailer.
      replyTo: input.email,
    });

    if (sent.success) {
      await admin
        .from("platform_inquiries")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", id);
    } else {
      // Left unstamped on purpose: the dashboard alert is what turns a silent
      // mail failure into something somebody sees.
      defaultLogger.error("[inquiries] notification email failed", sent.error);
    }
  } else {
    defaultLogger.warn(
      "[inquiries] TECHCLAVE_INQUIRY_EMAIL is not set; inquiry stored but nobody was emailed",
    );
  }

  return { ok: true, id };
}

/** Inquiries nobody has been told about. Drives the superadmin alert. */
export async function countUnnotifiedInquiries(
  admin: SupabaseClient,
): Promise<number> {
  const { count, error } = await admin
    .from("platform_inquiries")
    .select("id", { count: "exact", head: true })
    .is("notified_at", null)
    .is("handled_at", null);

  if (error) {
    defaultLogger.warn(
      "[inquiries] could not count unnotified inquiries",
      error,
    );
    return 0;
  }
  return count ?? 0;
}
