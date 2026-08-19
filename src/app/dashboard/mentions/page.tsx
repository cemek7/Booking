export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';

// Social mentions / listening is intentionally not shipped for launch — no
// reliable provider is wired yet. The feature code (components in
// src/components/listening, API routes under /api/listening, the
// social-listening cron) is kept dormant and reversible; this route redirects
// so the feature is unreachable, even by direct URL. To re-enable, restore the
// original page (git history) and the "Mentions" nav item in UnifiedDashboardNav.
export default async function MentionsPage() {
  redirect('/dashboard');
}
