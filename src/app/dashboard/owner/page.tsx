export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';

// The owner home was merged into /dashboard (single role-aware home page).
// Kept as a redirect so old links and bookmarks keep working.
export default function OwnerDashboardPage() {
  redirect('/dashboard');
}
