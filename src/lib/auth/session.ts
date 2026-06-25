import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { Session } from '@supabase/supabase-js';

interface SessionResult {
  session: Session | null;
  tenantId: string | null;
}

export async function getSession(req: NextRequest): Promise<SessionResult> {
  const supabase = createServerSupabaseClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return { session: null, tenantId: null };
  }

  // Build a minimal session-compatible object for callers that need it
  const session = { user } as unknown as Session;

  // Extract tenant_id from user's app_metadata
  const tenantId = user?.app_metadata?.tenant_id ?? null;

  if (!tenantId) {
     // If not in metadata, try to get it from the tenant_users table as a fallback
     const { data: tenantUserData } = await supabase
       .from('tenant_users')
       .select('tenant_id')
       .eq('user_id', user.id)
       .limit(1)
       .single();

     return { session, tenantId: tenantUserData?.tenant_id ?? null };
  }

  return { session, tenantId };
}
