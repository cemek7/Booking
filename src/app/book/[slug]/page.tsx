import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { publicBookingService } from '@/lib/publicBookingService';
import BookingContainer from './components/BookingContainer';
import BookingPageSkeleton from './components/BookingPageSkeleton';

interface BookingPageProps {
  params: {
    slug: string;
  };
}

export async function generateMetadata({ params }: BookingPageProps) {
  try {
    const tenant = await publicBookingService.getTenantPublicInfo(params.slug);
    return {
      title: `Book with ${tenant.name}`,
      description: `Schedule your appointment with ${tenant.name}`,
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
    // Verify tenant exists
    const tenant = await publicBookingService.getTenantPublicInfo(params.slug);
    
    if (!tenant) {
      notFound();
    }

    return (
      <Suspense fallback={<BookingPageSkeleton />}>
        <BookingContainer slug={params.slug} tenantId={tenant.id} />
      </Suspense>
    );
  } catch (error) {
    console.error(`Error loading booking page for slug: ${params.slug}`, error);
    notFound();
  }
}
