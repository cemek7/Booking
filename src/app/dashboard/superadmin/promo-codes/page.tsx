import type { Metadata } from 'next';
import { requireAuth } from '@/lib/auth/server-auth';
import PromoCodesClient from './PromoCodesClient';

export const metadata: Metadata = {
  title: 'Promo Codes | Superadmin',
  description: 'Create and retire promotional wallet credit codes.',
};

export default async function PromoCodesPage() {
  await requireAuth(['superadmin']);
  return <PromoCodesClient />;
}
