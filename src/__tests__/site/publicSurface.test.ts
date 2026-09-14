import { describe, it, expect } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

/**
 * The public site kept growing pages nobody could reach.
 *
 * The contact page is the case that prompted this: one existed at
 * /showcase/contact, nothing linked to it, and its form was a demonstrator that
 * made no network request — so a visitor who wanted to talk to us could not
 * find the page, and would not have reached anyone if they had. The privacy,
 * accessibility and data-retention pages were orphaned the same way.
 *
 * None of that breaks a build, fails a type check, or throws at runtime. The
 * page renders perfectly; it is simply unreachable. So the only thing that can
 * catch it is a test that asks the question nothing else asks: can a visitor
 * actually get here, and does what they submit go anywhere?
 *
 * These checks are deliberately about the PUBLIC marketing and legal surface —
 * pages a stranger must reach by clicking. Application pages are navigated
 * programmatically after sign-in and are listed as such below.
 */

const APP_DIR = join(process.cwd(), "src", "app");
const SRC_DIR = join(process.cwd(), "src");

/**
 * Pages a visitor must be able to reach by clicking, and where entry is
 * expected from. Adding a public page means adding it here — which is the
 * point: the registry is what forces someone to answer "how does anyone find
 * this?" at the time they build it.
 */
const PUBLIC_ROUTES = [
  "/",
  "/contact",
  "/products",
  "/showcase",
  "/booka",
  "/privacy",
  "/terms",
  "/cookies",
  "/refunds",
  "/acceptable-use",
  "/accessibility",
  "/data-retention",
  "/dpa",
  "/sub-processors",
  "/ugc-policy",
];

/**
 * Top-level routes that are NOT part of the public surface: reached after
 * sign-in, by redirect, by a scanned link, or by a share URL. Listed rather
 * than pattern-matched so a genuinely new public page cannot slip in by
 * accident — an unlisted route fails the last test in this file.
 */
const NON_PUBLIC_ROUTES = new Set([
  "api",
  "dashboard",
  "auth",
  "settings",
  "billing",
  "chat",
  "clients",
  "reservations",
  "schedule",
  "staff",
  "store",
  "tenant",
  "reviews",
  "voice",
  "book",
  "status",
  "unsubscribe",
  "fonts",
]);

/** Recursively collect every .ts/.tsx file under a directory. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Files that link to a route as an actual navigation target.
 *
 * Matching the bare string is not enough: the showcase sitemap lists '/contact'
 * as a path fragment it joins onto '/showcase', which would have made the real
 * /contact page look reachable when nothing linked to it. Only an href counts.
 */
function linksTo(route: string): string[] {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // href="/x", href={'/x'}, and the href: '/x' form used by card arrays.
  const pattern = new RegExp(`href\\s*[=:]\\s*\\{?\\s*["'\`]${escaped}["'\`]`);
  const ownPage = join(
    APP_DIR,
    route === "/" ? "" : route.slice(1),
    "page.tsx",
  );

  return sourceFiles(SRC_DIR)
    .filter((file) => file !== ownPage)
    .filter((file) => pattern.test(readFileSync(file, "utf8")));
}

/** Top-level directories under src/app that resolve to a real page. */
function topLevelRoutes(): string[] {
  return readdirSync(APP_DIR)
    .filter((entry) => {
      if (
        entry.startsWith("(") ||
        entry.startsWith("[") ||
        entry.startsWith("_")
      )
        return false;
      const full = join(APP_DIR, entry);
      return statSync(full).isDirectory();
    })
    .filter((entry) => {
      // Only count it as a route if there is a page somewhere beneath it.
      try {
        return sourceFiles(join(APP_DIR, entry)).some((f) =>
          f.endsWith("page.tsx"),
        );
      } catch {
        return false;
      }
    });
}

describe("public site surface", () => {
  it("has no public page that nothing links to", () => {
    const orphans = PUBLIC_ROUTES.filter(
      (route) => route !== "/" && linksTo(route).length === 0,
    );

    // A page a visitor cannot navigate to is the same as a page that does not
    // exist, except that it looks finished.
    expect(orphans).toEqual([]);
  });

  it("links to the contact page from the home page", () => {
    const home = readFileSync(join(APP_DIR, "page.tsx"), "utf8");
    // The entry point that was missing entirely: someone who wants to talk to
    // us has to find it from the front door, not by guessing a URL.
    expect(home).toContain('"/contact"');
  });

  it("backs the contact form with a route that actually receives it", () => {
    const form = readFileSync(
      join(process.cwd(), "src", "components", "contact", "ContactForm.tsx"),
      "utf8",
    );
    expect(form).toMatch(/fetch\(\s*["'`]\/api\/contact["'`]/);

    // The showcase's LeadForm is an explicit demonstrator that makes no network
    // request. A form that silently discards what people write must never stand
    // in for a real one.
    const handler = join(APP_DIR, "api", "contact", "route.ts");
    expect(readFileSync(handler, "utf8")).toContain("submitInquiry");
  });

  it("keeps the mock lead form inside the showcase", () => {
    const users = sourceFiles(SRC_DIR).filter(
      (file) =>
        readFileSync(file, "utf8").includes("LeadForm") &&
        !file.includes(join("components", "capability")),
    );

    const outsideShowcase = users.filter(
      (file) => !file.includes("(showcase)"),
    );

    // LeadForm never calls the network by design. Anywhere but a demonstrator,
    // that is a form that thanks people and throws their message away.
    expect(outsideShowcase).toEqual([]);
  });

  it("forces every new top-level route to be classified public or not", () => {
    const unclassified = topLevelRoutes().filter(
      (route) =>
        !NON_PUBLIC_ROUTES.has(route) && !PUBLIC_ROUTES.includes(`/${route}`),
    );

    // Failing here is not a bug report, it is a question: can a stranger reach
    // this page, and how? Answer it by adding the route to PUBLIC_ROUTES (and
    // linking to it) or to NON_PUBLIC_ROUTES.
    expect(unclassified).toEqual([]);
  });
});
