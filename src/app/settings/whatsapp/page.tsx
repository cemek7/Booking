export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation';
export default function WhatsAppSettingsPage() { redirect('/dashboard/settings?tab=whatsapp'); }
