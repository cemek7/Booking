export const dynamic = 'force-dynamic';

import { requireAuth } from '@/lib/auth/server-auth';
import ShowcaseBuilderClient from '@/components/showcase/ShowcaseBuilderClient';

export default async function ShowcasePage() {
  await requireAuth(['owner', 'manager']);

  return <ShowcaseBuilderClient />;
}
