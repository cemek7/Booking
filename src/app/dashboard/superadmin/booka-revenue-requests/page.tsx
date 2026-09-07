import type { Metadata } from 'next';
import { requireAuth } from '@/lib/auth/server-auth';
import RevenueRequestsClient from './RevenueRequestsClient';

export const metadata: Metadata = {
  title: 'Booka Revenue Requests | Superadmin',
  description: 'Qualify Booka Revenue Pilot applications and prepare Missed Revenue Reports.',
};

export default async function BookaRevenueRequestsPage() {
  await requireAuth(['superadmin']);
  return <RevenueRequestsClient />;
}
