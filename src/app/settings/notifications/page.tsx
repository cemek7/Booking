export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation';
export default function NotificationSettingsPage() { redirect('/dashboard/settings?tab=notifications'); }
