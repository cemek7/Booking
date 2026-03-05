import { Suspense } from 'react';
import ReviewPageClient from './ReviewPageClient';

interface ReviewPageProps {
  params: { slug: string };
  searchParams: { reservationId?: string };
}

export async function generateMetadata({ params }: ReviewPageProps) {
  return {
    title: 'Leave a Review',
    description: `Share your experience and leave a review.`,
  };
}

export default function ReviewPage({ params, searchParams }: ReviewPageProps) {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500 text-sm">Loading…</p>
      </div>
    }>
      <ReviewPageClient slug={params.slug} reservationId={searchParams.reservationId} />
    </Suspense>
  );
}
