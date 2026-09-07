import type { SupabaseClient } from '@supabase/supabase-js';
import { defaultLogger } from '@/lib/logger';

type AdminRow = { email: string | null; status: boolean | string | null };

/** Normalize the email identity key used by the legacy admins table. */
export function normalizeAdminEmail(email?: string | null): string | null {
  const normalized = email?.trim().toLowerCase() ?? '';
  return normalized || null;
}

function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/**
 * Resolve a platform admin without requiring tenant membership. Existing admin
 * emails are not guaranteed to be lower-case, so the lookup is case-insensitive.
 */
export async function resolveActiveGlobalAdmin(
  supabase: SupabaseClient,
  email?: string | null
): Promise<AdminRow | null> {
  const normalizedEmail = normalizeAdminEmail(email);
  if (!normalizedEmail) return null;

  try {
    const { data, error } = await supabase
      .from('admins')
      .select('email, status')
      .ilike('email', escapeIlikePattern(normalizedEmail))
      .maybeSingle();

    if (error) {
      defaultLogger.warn('[Auth] Global admin lookup failed', { email: normalizedEmail, error: error.message });
      return null;
    }

    // Legacy deployments have nullable status. Explicitly disabled rows must
    // not retain global access; existing active/null rows remain compatible.
    return data && data.status !== false ? (data as AdminRow) : null;
  } catch (error) {
    defaultLogger.warn('[Auth] Global admin lookup threw', {
      email: normalizedEmail,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function isActiveGlobalAdmin(supabase: SupabaseClient, email?: string | null): Promise<boolean> {
  return !!(await resolveActiveGlobalAdmin(supabase, email));
}
