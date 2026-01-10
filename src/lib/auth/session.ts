import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { Session } from '@supabase/supabase-js';

interface SessionResult {
  session: Session | null;
  tenantId: string | null;
}

export async function getSession(req: NextRequest): Promise<SessionResult> {
  const supabase = createServerSupabaseClient();
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !session) {
    return { session: null, tenantId: null };
  }

  // Extract tenant_id from user's app_metadata
  const tenantId = session.user?.app_metadata?.tenant_id ?? null;

  if (!tenantId) {
     // If not in metadata, try to get it from the tenant_users table as a fallback
     const { data: tenantUserData } = await supabase
       .from('tenant_users')
       .select('tenant_id')
       .eq('user_id', session.user.id)
       .limit(1)
       .single();
     
     return { session, tenantId: tenantUserData?.tenant_id ?? null };
  }

  return { session, tenantId };
}
