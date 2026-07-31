import { requireCapability } from '@/lib/auth/require-capability';

// Capability page-guard: redirects to /dashboard when the tenant has 'inventory'
// disabled. Defense-in-depth for capability scoping (own-tenant data).
export default async function SectionLayout({ children }: { children: React.ReactNode }) {
  await requireCapability('inventory');
  return <>{children}</>;
}
