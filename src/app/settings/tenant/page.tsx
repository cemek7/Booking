export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation';
export default function TenantSettingsPage() { redirect('/dashboard/settings?tab=tenant'); }
