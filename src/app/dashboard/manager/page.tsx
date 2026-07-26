export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation';

// The manager home was merged into /dashboard (single role-aware home page).
// Kept as a redirect so old links and bookmarks keep working.
export default function ManagerDashboardPage() {
  redirect('/dashboard');
}
