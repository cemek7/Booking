import { describe, it, expect } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * Every email address written into the product must be on a domain we control,
 * or on a domain that can never receive mail.
 *
 * This exists because the privacy policy, terms and every other legal page told
 * people to write to privacy@boka.app, legal@boka.app and support@boka.app.
 * boka.app is not ours. It is parked for sale, and its mail already forwards to
 * someone else's service — so data-protection requests, and Paystack receipts
 * sent to the placeholder noemail@boka.app, would have gone to a stranger.
 *
 * Nothing about that fails a build. The page renders and the payment goes
 * through. The domain simply belongs to somebody else.
 */

const SRC_DIR = join(process.cwd(), "src");

/** Domains Techclave owns. Subdomains count. */
const OWNED = ["techclave.cloud"];

/**
 * Reserved by RFC 2606 / IANA for documentation. Mail to these can never be
 * delivered, which is exactly what a placeholder needs.
 */
const RESERVED = ["example.com", "example.org", "example.net"];

/**
 * Illustrative addresses shown to people as examples of what to type — form
 * placeholders and chat copy. Nothing is ever sent to them. Add to this list
 * only for text a person reads, never for an address the code sends to.
 */
const ILLUSTRATIVE = [
  "salon.ng",
  "yourbusiness.ng",
  "yourbrand.com",
  "company.com",
  "business.com",
];

/** Not email at all: WhatsApp's JID suffix has the same shape. */
const NOT_EMAIL = ["s.whatsapp.net"];

const EMAIL =
  /[a-zA-Z0-9._%+-]+@([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-z]{2,})/g;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
      acc.push(full);
  }
  return acc;
}

function isAllowed(domain: string): boolean {
  const d = domain.toLowerCase();
  const matches = (base: string) => d === base || d.endsWith(`.${base}`);
  return [...OWNED, ...RESERVED, ...ILLUSTRATIVE, ...NOT_EMAIL].some(matches);
}

describe("email addresses in the product", () => {
  it("are all on a domain we control or one that cannot receive mail", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC_DIR)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(EMAIL)) {
        if (!isAllowed(match[1])) {
          offenders.push(`${relative(process.cwd(), file)}: ${match[0]}`);
        }
      }
    }

    // A failure here means real mail could go to a domain somebody else owns.
    // Move the address onto techclave.cloud and add a Cloudflare routing rule,
    // or use example.com for a placeholder that must never be delivered.
    expect(offenders).toEqual([]);
  });

  it("does not treat a lookalike as ours", () => {
    expect(isAllowed("techclave.cloud")).toBe(true);
    expect(isAllowed("mail.techclave.cloud")).toBe(true);
    // Suffix matching without the dot would let this through.
    expect(isAllowed("nottechclave.cloud")).toBe(false);
    expect(isAllowed("boka.app")).toBe(false);
    expect(isAllowed("booka.io")).toBe(false);
  });
});
