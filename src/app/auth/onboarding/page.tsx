export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import OnboardingClientPage from './OnboardingClientPage';
import { createServerSupabaseClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { getRoleDashboardPath } from '@/types/unified-permissions';

async function isSuperadmin(userId: string, email?: string | null): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const normalizedEmail = email?.trim().toLowerCase() ?? '';

  if (normalizedEmail) {
    const { data: adminByEmail } = await admin
      .from('admins')
      .select('email, status')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (adminByEmail) return true;
  }
  return false;
}

export default async function OnboardingPage() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <OnboardingClientPage />;
  }

  if (await isSuperadmin(user.id, user.email)) {
    redirect('/dashboard/superadmin');
  }

  const { data: memberships } = await createSupabaseAdminClient()
    .from('tenant_users')
    .select('role')
    .eq('user_id', user.id)
    .order('tenant_id', { ascending: true })
    .limit(1);

  const role = memberships?.[0]?.role;
  if (role) {
    redirect(getRoleDashboardPath(role));
  }

  return <OnboardingClientPage />;
}
