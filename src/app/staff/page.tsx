export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation';

export default function StaffRedirectPage() {
  redirect('/dashboard/staff-dashboard');
}
