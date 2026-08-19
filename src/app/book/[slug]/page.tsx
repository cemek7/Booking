export const dynamic = 'force-dynamic';
import { defaultLogger } from '@/lib/logger';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getTenantPublicInfo, getTenantServices } from '@/lib/publicBookingService';
import MiniSiteContainer from './components/MiniSiteContainer';
import BookingPageSkeleton from './components/BookingPageSkeleton';

interface BookingPageProps {
  // Next 16: route params are async and must be awaited.
  params: Promise<{
    slug: string;
  }>;
}

export async function generateMetadata({ params }: BookingPageProps) {
  const { slug } = await params;
  try {
    const tenant = await getTenantPublicInfo(slug);
    return {
      title: `${tenant.name} — Book an Appointment`,
      description: tenant.description || `Schedule your appointment with ${tenant.name}`,
    };
  } catch {
    return {
      title: 'Book an Appointment',
      description: 'Schedule your appointment online',
    };
  }
}

export default async function BookingPage({ params }: BookingPageProps) {
  const { slug } = await params;
  try {
    const tenant = await getTenantPublicInfo(slug);

    if (!tenant) {
      notFound();
    }

    const services = await getTenantServices(tenant.id).catch(() => []);

    return (
      <Suspense fallback={<BookingPageSkeleton />}>
        <MiniSiteContainer tenant={tenant} services={services} />
      </Suspense>
    );
  } catch (error) {
    defaultLogger.error(`Error loading booking page for slug: ${slug}`, error);
    notFound();
  }
}
