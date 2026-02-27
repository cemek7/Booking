import { requireAuth } from '@/lib/auth/server-auth';
import FaqsClient from './FaqsClient';

export default async function FaqsPage() {
  await requireAuth(['owner', 'manager']);
  return <FaqsClient />;
}
