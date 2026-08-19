export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/server-auth';
import { Metadata } from 'next';
import TenantsClient from './TenantsClient';

export const metadata: Metadata = {
  title: 'Tenant Management | Booka Superadmin',
  description: 'Manage tenants, view calendars, and monitor LLM usage across the platform',
};

export default async function SuperadminTenantsPage() {
  const user = await requireAuth(['superadmin']);
  return <TenantsClient user={user} />;
}
