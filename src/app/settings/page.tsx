export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation';

// Settings consolidated into /dashboard/settings — redirect (preserving ?tab=).
export default async function SettingsRedirect({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  redirect(tab ? `/dashboard/settings?tab=${encodeURIComponent(tab)}` : '/dashboard/settings');
}
