import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getTenantCapabilities } from '@/lib/capabilities';

/**
 * Owner-facing preview links for the tenant's public pages. Shows the booking
 * page when `bookings` is enabled and the storefront when `sales` is enabled —
 * so a sales-only tenant gets a storefront preview instead of a booking page.
 */
export default async function PublicLinksCard({ tenantId }: { tenantId: string }) {
  const admin = createSupabaseAdminClient();
  const [{ data: tenant }, caps] = await Promise.all([
    admin.from('tenants').select('slug').eq('id', tenantId).maybeSingle(),
    getTenantCapabilities(admin, tenantId),
  ]);

  const slug = (tenant as { slug?: string | null } | null)?.slug ?? null;

  const links = [
    caps.bookings && slug ? { label: 'Booking page', href: `/book/${slug}`, desc: 'Customers book appointments.' } : null,
    caps.sales && slug ? { label: 'Storefront', href: `/store/${slug}`, desc: 'Customers browse products and order.' } : null,
  ].filter(Boolean) as Array<{ label: string; href: string; desc: string }>;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Your public pages</h2>
      <p className="mt-1 text-sm text-gray-600">Preview and share the pages your customers see.</p>

      {!slug ? (
        <p className="mt-4 text-sm text-amber-700">
          Set a business URL (slug) in your profile to publish your public pages.
        </p>
      ) : links.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          Enable Bookings or Sales in Workflows above to publish a public page.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {links.map((l) => (
            <li key={l.href} className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <span>
                <span className="block text-sm font-medium text-gray-900">{l.label}</span>
                <span className="block text-xs text-gray-500">{l.desc}</span>
                <code className="mt-0.5 block text-xs text-gray-400">{l.href}</code>
              </span>
              <a
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700"
              >
                Preview ↗
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
