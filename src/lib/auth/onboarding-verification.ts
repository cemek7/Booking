/**
 * Onboarding must verify the specific email the user entered, not blindly trust
 * whatever Supabase session happens to already exist in the browser. A leftover
 * session for a different email must NOT bypass verification — otherwise the
 * workspace is silently created under the wrong identity.
 *
 * Returns true only when an active session belongs to the same email being
 * onboarded (case- and whitespace-insensitive).
 */
export function sessionVerifiesEmail(
  sessionEmail: string | null | undefined,
  enteredEmail: string | null | undefined
): boolean {
  const session = (sessionEmail ?? '').trim().toLowerCase();
  const entered = (enteredEmail ?? '').trim().toLowerCase();
  return session.length > 0 && entered.length > 0 && session === entered;
}
