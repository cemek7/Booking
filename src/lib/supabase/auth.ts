import { getSupabaseBrowserClientAsync } from './client';

/**
 * Returns the current user's role from the active Supabase session.
 * Role is read from user_metadata (set at sign-up / tenant onboarding).
 * Falls back to 'staff' if no role metadata exists.
 *
 * Uses the async client: the sync client returns a proxy whose auth.getUser()
 * yields a null user under runtime config, which would wrongly return null.
 */
export async function getUserRole(): Promise<string | null> {
  const supabase = await getSupabaseBrowserClientAsync();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return (user.user_metadata?.role as string | undefined) ?? 'staff';
}
