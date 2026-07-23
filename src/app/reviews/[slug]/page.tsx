export const dynamic = 'force-dynamic';
import { Suspense } from 'react';
import ReviewPageClient from './ReviewPageClient';

interface ReviewPageProps {
  // Next 16: params and searchParams are async.
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ reservationId?: string }>;
}

export async function generateMetadata() {
  return {
    title: 'Leave a Review',
    description: `Share your experience and leave a review.`,
  };
}

export default async function ReviewPage({ params, searchParams }: ReviewPageProps) {
  const { slug } = await params;
  const { reservationId } = await searchParams;
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500 text-sm">Loading…</p>
      </div>
    }>
      <ReviewPageClient slug={slug} reservationId={reservationId} />
    </Suspense>
  );
}
