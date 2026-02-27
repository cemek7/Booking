'use client';

import { useEffect, useState } from 'react';

interface Review {
  id: string;
  customer_name: string;
  rating: number;
  comment?: string;
  created_at: string;
}

interface ReviewFormState {
  customer_name: string;
  rating: number;
  comment: string;
}

interface TenantInfo {
  name: string;
  description?: string;
  logo?: string;
}

function StarRating({
  rating,
  interactive = false,
  onChange,
}: {
  rating: number;
  interactive?: boolean;
  onChange?: (r: number) => void;
}) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={!interactive}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => interactive && setHovered(star)}
          onMouseLeave={() => interactive && setHovered(0)}
          className={`text-2xl leading-none ${!interactive ? 'cursor-default' : 'cursor-pointer'}`}
        >
          <span className={star <= (hovered || rating) ? 'text-yellow-400' : 'text-gray-200'}>★</span>
        </button>
      ))}
    </div>
  );
}

interface ReviewPageClientProps {
  slug: string;
  reservationId?: string;
}

export default function ReviewPageClient({ slug, reservationId }: ReviewPageClientProps) {
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [form, setForm] = useState<ReviewFormState>({ customer_name: '', rating: 5, comment: '' });

  useEffect(() => {
    Promise.all([
      fetch(`/api/public/${slug}`).then((r) => r.json()).catch(() => null),
      fetch(`/api/public/${slug}/reviews`).then((r) => r.json()).catch(() => ({ data: [] })),
    ]).then(([tenantData, reviewData]) => {
      if (tenantData?.id) setTenant(tenantData);
      setReviews(reviewData?.data ?? []);
    }).finally(() => setLoading(false));
  }, [slug]);

  async function submitReview() {
    if (!form.customer_name.trim()) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      const res = await fetch(`/api/public/${slug}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: form.customer_name,
          rating: form.rating,
          comment: form.comment || undefined,
          reservation_id: reservationId,
        }),
      });
      if (res.ok) {
        const json = await res.json() as { data?: Review };
        if (json.data) setReviews((prev) => [json.data as Review, ...prev]);
        setSubmitted(true);
        setForm({ customer_name: '', rating: 5, comment: '' });
      } else {
        setSubmitError(true);
      }
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  }

  const avgRating =
    reviews.length > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500 text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-xl mx-auto px-4 py-10 space-y-8">
        {/* Business header */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border text-center space-y-2">
          {tenant?.logo && (
            <img src={tenant.logo} alt={tenant.name} className="w-16 h-16 rounded-full mx-auto object-cover" />
          )}
          <h1 className="text-2xl font-bold text-gray-900">{tenant?.name ?? 'Leave a Review'}</h1>
          {tenant?.description && (
            <p className="text-sm text-gray-600">{tenant.description}</p>
          )}
          {reviews.length > 0 && (
            <div className="flex items-center justify-center gap-2 pt-1">
              <StarRating rating={Math.round(avgRating)} />
              <span className="text-sm text-gray-600">
                {avgRating.toFixed(1)} · {reviews.length} review{reviews.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {/* Review form */}
        {!submitted ? (
          <div className="bg-white rounded-2xl p-6 shadow-sm border space-y-4">
            <h2 className="font-semibold text-lg">Share your experience</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Your name <span className="text-red-500">*</span>
              </label>
              <input
                value={form.customer_name}
                onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Your name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Rating</label>
              <StarRating
                rating={form.rating}
                interactive
                onChange={(r) => setForm((f) => ({ ...f, rating: r }))}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Comment (optional)</label>
              <textarea
                value={form.comment}
                onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
                rows={4}
                className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
                placeholder="Tell others about your experience…"
              />
            </div>

            {submitError && (
              <p className="text-sm text-red-600">Failed to submit. Please try again.</p>
            )}

            <button
              onClick={submitReview}
              disabled={submitting || !form.customer_name.trim()}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium disabled:opacity-60 hover:bg-indigo-700 transition-colors"
            >
              {submitting ? 'Submitting…' : 'Submit Review'}
            </button>
          </div>
        ) : (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center space-y-2">
            <div className="text-4xl">🙏</div>
            <h2 className="font-semibold text-green-900">Thank you for your review!</h2>
            <p className="text-sm text-green-700">Your feedback helps us serve you better.</p>
          </div>
        )}

        {/* Existing reviews */}
        {reviews.length > 0 && (
          <div className="space-y-4">
            <h2 className="font-semibold text-lg text-gray-900">What others are saying</h2>
            {reviews.map((review) => (
              <div key={review.id} className="bg-white rounded-xl border p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-sm text-gray-900">{review.customer_name}</p>
                    <StarRating rating={review.rating} />
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(review.created_at).toLocaleDateString()}
                  </span>
                </div>
                {review.comment && (
                  <p className="text-sm text-gray-600">{review.comment}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
