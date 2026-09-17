/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * Service-role access must be lazy, server-only, and impossible to trip over.
 *
 * `next build` imports every route and library module to collect them, with no
 * secrets present. A client created at module scope therefore either fails the
 * build or, worse, pushes someone to hand the build a production secret. The
 * key belongs to the runtime.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

const isTest = (file: string) =>
  file.includes(`${"__tests__"}`) ||
  /\.test\.tsx?$/.test(file) ||
  file.includes(join("src", "test"));

/** Strip comments so prose about the rule does not trip the rule. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** Files allowed to read the service-role key: the helpers and env validation. */
const KEY_READERS = [
  join("src", "lib", "supabase", "admin.ts"),
  join("src", "lib", "supabase", "server.ts"),
  join("src", "lib", "config", "env.ts"),
  join("src", "lib", "envValidation.ts"),
  // Reads it as a fallback salt/secret, never to build a privileged client.
  join("src", "lib", "inquiries", "platformInquiries.ts"),
  join("src", "lib", "storefront", "context.ts"),
  join("src", "lib", "whatsapp", "messageProcessor.ts"),
  join("src", "app", "api", "health", "route.ts"),
  join("src", "app", "api", "ready", "route.ts"),
  join("src", "app", "api", "onboarding", "tenant", "route.ts"),
];

describe("service-role access", () => {
  it("is never created at module scope", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      if (isTest(file)) continue;
      code(file)
        .split("\n")
        .forEach((line, i) => {
          // A top-level binding, i.e. no leading indentation.
          if (
            !/^(const|let|var)\s+\w+\s*=\s*(await\s+)?(getSupabaseAdmin|createClient)\s*\(/.test(
              line,
            )
          )
            return;
          offenders.push(
            `${relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`,
          );
        });
    }

    // Move the call inside the handler, worker or action that needs it.
    expect(offenders).toEqual([]);
  });

  it("reads the key only in the helpers that own it", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !isTest(file))
      .filter((file) => !KEY_READERS.includes(relative(process.cwd(), file)))
      .filter((file) => code(file).includes("SUPABASE_SERVICE_ROLE_KEY"))
      .map((file) => relative(process.cwd(), file));

    // Everything else asks getSupabaseAdmin() for a client instead.
    expect(offenders).toEqual([]);
  });

  it("is not imported by any client component", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !isTest(file))
      .filter((file) => {
        const text = code(file);
        const isClient = /^\s*["']use client["']/m.test(text);
        return (
          isClient &&
          /(from\s+["']@\/lib\/supabase\/(admin|server)["'])/.test(text)
        );
      })
      .map((file) => relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});

describe("the existing lazy proxy factory", () => {
  // 17 modules bind createSupabaseAdminClient() at module scope. That is safe
  // ONLY because it returns a proxy that reads the environment on first
  // property access. If the proxy ever becomes eager, every one of those
  // modules fails `next build` at once.
  //
  // jest.setup replaces @/lib/supabase/server globally, so this reaches past
  // the mock for the real implementation; otherwise the test would pass no
  // matter what the real factory does.
  it("creates nothing, and reads nothing, until it is used", () => {
    const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const actual = jest.requireActual<typeof import("@/lib/supabase/server")>(
        "@/lib/supabase/server",
      );

      const client = actual.createSupabaseAdminClient();
      expect(client).toBeDefined();

      // Touching it is what demands configuration.
      expect(() => (client as unknown as Record<string, unknown>).from).toThrow(
        /Service Role Key/i,
      );
    } finally {
      if (saved === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
    }
  });
});

describe("getSupabaseAdmin", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("does not touch the environment when the module is imported", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    // Importing must be safe with no configuration at all: this is what a build
    // does, thousands of times, with no secrets present.
    await expect(import("@/lib/supabase/admin")).resolves.toBeDefined();
  });

  it("throws a precise error, naming no value, when called unconfigured", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    const { getSupabaseAdmin } = await import("@/lib/supabase/admin");

    expect(() => getSupabaseAdmin()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    try {
      getSupabaseAdmin();
    } catch (error) {
      // The message must be safe to log.
      expect(String(error)).not.toContain("https://example.supabase.co");
    }
  });

  it("returns the same client on repeated calls once configured", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    const { getSupabaseAdmin } = await import("@/lib/supabase/admin");

    expect(getSupabaseAdmin()).toBe(getSupabaseAdmin());
  });
});
