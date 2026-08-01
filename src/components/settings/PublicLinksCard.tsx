import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getTenantCapabilities } from '@/lib/capabilities';

/**
 * Owner-facing share hub: QR codes + links for the tenant's public pages so they
 * never have to type/share URLs. Shows the booking page when `bookings` is on,
 * the storefront when `sales` is on, and a WhatsApp deep-link (shared Booka
 * number + the tenant's routing_code) that starts a chat routed to them.
 */
async function toQr(url: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(url, { width: 240, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } });
  } catch {
    return null;
  }
}

export default async function PublicLinksCard({ tenantId }: { tenantId: string }) {
  const admin = createSupabaseAdminClient();
  const [{ data: tenant }, caps, hdrs] = await Promise.all([
    admin.from('tenants').select('slug, routing_code').eq('id', tenantId).maybeSingle(),
    getTenantCapabilities(admin, tenantId),
    headers(),
  ]);

  const slug = (tenant as { slug?: string | null } | null)?.slug ?? null;
  const routingCode = (tenant as { routing_code?: string | null } | null)?.routing_code ?? null;

  const host = hdrs.get('host');
  const proto = hdrs.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https');
  const origin = host ? `${proto}://${host}` : '';
  const waNumber = process.env.EVOLUTION_DEFAULT_PHONE || '';

  type Share = { key: string; label: string; desc: string; url: string; download: string };
  const shares: Share[] = [];
  if (caps.bookings && slug) shares.push({ key: 'book', label: 'Booking page', desc: 'Customers book appointments.', url: `${origin}/book/${slug}`, download: `booking-${slug}.png` });
  if (caps.sales && slug) shares.push({ key: 'store', label: 'Storefront', desc: 'Customers browse products and order.', url: `${origin}/store/${slug}`, download: `store-${slug}.png` });
  if (routingCode && waNumber) shares.push({ key: 'wa', label: 'WhatsApp', desc: 'Starts a WhatsApp chat routed to you.', url: `https://wa.me/${waNumber}?text=${encodeURIComponent(routingCode)}`, download: `whatsapp-${routingCode}.png` });

  const withQr = await Promise.all(shares.map(async (s) => ({ ...s, qr: await toQr(s.url) })));

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Share your business</h2>
      <p className="mt-1 text-sm text-gray-600">Print or send these QR codes — customers scan to book, shop, or chat with you.</p>

      {!slug ? (
        <p className="mt-4 text-sm text-amber-700">Set a business URL (slug) in your profile to publish your public pages.</p>
      ) : withQr.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">Enable Bookings or Sales in Workflows above to publish a public page.</p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {withQr.map((s) => (
            <div key={s.key} className="flex flex-col items-center rounded-xl border border-gray-100 bg-gray-50 p-4 text-center">
              <span className="text-sm font-semibold text-gray-900">{s.label}</span>
              <span className="mt-0.5 text-xs text-gray-500">{s.desc}</span>
              {s.qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.qr} alt={`${s.label} QR code`} width={160} height={160} className="mt-3 h-40 w-40 rounded-lg bg-white p-1 shadow-sm" />
              ) : (
                <div className="mt-3 flex h-40 w-40 items-center justify-center rounded-lg bg-white text-xs text-gray-400 shadow-sm">QR unavailable</div>
              )}
              <code className="mt-3 block max-w-full truncate text-[11px] text-gray-400">{s.url}</code>
              <div className="mt-2 flex gap-2">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-gray-800">Open ↗</a>
                {s.qr && <a href={s.qr} download={s.download} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-100">Download QR</a>}
              </div>
            </div>
          ))}
        </div>
      )}
      {slug && !routingCode && (
        <p className="mt-3 text-xs text-gray-400">Connect WhatsApp to get a scannable chat link.</p>
      )}
    </section>
  );
}
