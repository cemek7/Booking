import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth/server-auth';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getTenantCapabilities, type Capability } from '@/lib/capabilities';

/**
 * Server-side capability guard for dashboard sections.
 *
 * Redirects to /dashboard when the tenant has `capability` turned off — so a
 * typed/bookmarked URL to a disabled surface doesn't render a workflow the owner
 * disabled. This is defense-in-depth for capability *scoping*, NOT a security
 * boundary: the data behind every gated route is the tenant's own. Superadmin
 * and tenantless sessions are all-on and pass straight through.
 *
 * Use in a section `layout.tsx` (server component):
 *   export default async function Layout({ children }) {
 *     await requireCapability('bookings');
 *     return <>{children}</>;
 *   }
 */
export async function requireCapability(capability: Capability): Promise<void> {
  const user = await requireAuth(['owner', 'manager', 'staff', 'superadmin']);
  if (!user.tenantId) return; // superadmin / no tenant → all-on
  const caps = await getTenantCapabilities(createSupabaseAdminClient(), user.tenantId);
  if (!caps[capability]) redirect('/dashboard');
}
