export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import OnboardingClientPage from './OnboardingClientPage';
import { createServerSupabaseClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { getRoleDashboardPath } from '@/types/unified-permissions';
import { isTenantOnboardingIncomplete } from '@/lib/onboarding/state';

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

  const admin = createSupabaseAdminClient();
  const { data: memberships } = await admin
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .order('tenant_id', { ascending: true })
    .limit(1);

  const membership = memberships?.[0];
  const role = membership?.role;
  if (role) {
    const { data: tenant } = membership?.tenant_id
      ? await admin
          .from('tenants')
          .select('id, slug, name, timezone, settings, metadata')
          .eq('id', membership.tenant_id)
          .maybeSingle()
      : { data: null };

    if (isTenantOnboardingIncomplete(tenant)) {
      return (
        <OnboardingClientPage
          initialTenantId={membership.tenant_id}
          initialTenantSlug={tenant?.slug ?? null}
          initialResumeMode
        />
      );
    }

    redirect(getRoleDashboardPath(role));
  }

  return <OnboardingClientPage />;
}
