export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation';
export default function BusinessSettingsPage() { redirect('/dashboard/settings?tab=business'); }
