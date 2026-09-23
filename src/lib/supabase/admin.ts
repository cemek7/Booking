import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The one way to get a service-role Supabase client.
 *
 * Service-role access bypasses row-level security, so this module exists to
 * make privileged access deliberate, lazy and server-only:
 *
 *   - Lazy. The key is read when the client is first used, never when a module
 *     is imported. `next build` imports every route and library module to
 *     collect them, with no secrets present, so anything that reads the key at
 *     import time fails the build — and the fix must not be to hand the build a
 *     production secret.
 *   - Server-only. Importing this from client code throws immediately rather
 *     than shipping a path that could put the key in a browser bundle.
 *   - Quiet. The error says what is missing and never includes a value.
 */

let cached: SupabaseClient | null = null;

/** Thrown when privileged access is attempted without configuration. */
export class SupabaseAdminNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(
      `Service-role Supabase access requires ${missing.join(" and ")}. ` +
        "Set it in the runtime environment, never in the build.",
    );
    this.name = "SupabaseAdminNotConfiguredError";
  }
}

/**
 * Returns the service-role client, creating it on first call.
 *
 * Call this INSIDE the request handler, worker or action that needs it. Calling
 * it at module scope reintroduces exactly the import-time initialization this
 * module exists to prevent, and src/__tests__/lib/supabase/adminUsage.test.ts
 * fails the build if you do.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "getSupabaseAdmin() is server-only and must never be imported by client code.",
    );
  }

  if (cached) return cached;

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) throw new SupabaseAdminNotConfiguredError(missing);

  cached = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Test seam. Never call this from application code. */
export function resetSupabaseAdminForTests(): void {
  cached = null;
}
