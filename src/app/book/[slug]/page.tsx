import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getTenantPublicInfo, getTenantServices } from '@/lib/publicBookingService';
import MiniSiteContainer from './components/MiniSiteContainer';
import BookingPageSkeleton from './components/BookingPageSkeleton';

interface BookingPageProps {
  params: {
    slug: string;
  };
}

export async function generateMetadata({ params }: BookingPageProps) {
  try {
    const tenant = await getTenantPublicInfo(params.slug);
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

export const revalidate = 60; // ISR - revalidate every 60 seconds

export default async function BookingPage({ params }: BookingPageProps) {
  try {
    const tenant = await getTenantPublicInfo(params.slug);

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
    console.error(`Error loading booking page for slug: ${params.slug}`, error);
    notFound();
  }
}
