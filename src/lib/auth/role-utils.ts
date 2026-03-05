/**
 * Role utilities for auth-based permission checking.
 * Provides convenience helpers for reading a user's role from tenant_users.
 */
import { createSupabaseAdminClient } from '@/lib/supabase/server';

/**
 * Get the role string for a given user ID from the tenant_users table.
 * Returns 'staff' as default if no role is found.
 */
export async function getUserRole(userId: string): Promise<string> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from('tenant_users')
      .select('role')
      .eq('user_id', userId)
      .limit(1)
      .single();
    return data?.role ?? 'staff';
  } catch {
    return 'staff';
  }
}
