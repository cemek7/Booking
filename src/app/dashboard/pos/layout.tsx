import { requireCapability } from '@/lib/auth/require-capability';

// Capability page-guard: POS is part of the sales workflow.
export default async function SectionLayout({ children }: { children: React.ReactNode }) {
  await requireCapability('sales');
  return <>{children}</>;
}
