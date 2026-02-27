'use client';

import { useEffect, useState } from 'react';
import StarRating from '@/components/StarRating';

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

interface ReviewsSectionProps {
  slug: string;
}

export default function ReviewsSection({ slug }: ReviewsSectionProps) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [form, setForm] = useState<ReviewFormState>({ customer_name: '', rating: 5, comment: '' });

  useEffect(() => {
    fetch(`/api/public/${slug}/reviews`)
      .then((r) => r.json())
      .then((j) => setReviews(j.data ?? []))
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, [slug]);

  async function submitReview() {
    if (!form.customer_name.trim()) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      const res = await fetch(`/api/public/${slug}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const json = await res.json() as { data?: Review };
        if (json.data) setReviews((prev) => [json.data as Review, ...prev]);
        setSubmitted(true);
        setShowForm(false);
        setForm({ customer_name: '', rating: 5, comment: '' });
      } else {
        setSubmitError(true);
      }
    } catch {
      setSubmitError(true);
    }
    finally { setSubmitting(false); }
  }

  const avgRating = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : 0;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Customer Reviews</h2>
          {reviews.length > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <StarRating rating={Math.round(avgRating)} />
              <span className="text-sm text-slate-600">
                {avgRating.toFixed(1)} · {reviews.length} review{reviews.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
        {!submitted && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
          >
            Leave a Review
          </button>
        )}
      </div>

      {/* Review form */}
      {showForm && (
        <div className="bg-slate-50 border rounded-xl p-4 space-y-3">
          <h3 className="font-medium text-sm">Share your experience</h3>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Your name</label>
            <input
              value={form.customer_name}
              onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Rating</label>
            <StarRating
              rating={form.rating}
              interactive
              onChange={(r) => setForm((f) => ({ ...f, rating: r }))}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Comment (optional)</label>
            <textarea
              value={form.comment}
              onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
              rows={3}
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
              placeholder="Tell others about your experience…"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={submitReview}
              disabled={submitting || !form.customer_name.trim()}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg disabled:opacity-60"
            >
              {submitting ? 'Submitting…' : 'Submit Review'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border text-sm rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {submitted && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700">
          ✓ Thank you for your review!
        </div>
      )}

      {submitError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
          Failed to submit review. Please try again.
        </div>
      )}

      {/* Reviews list */}
      {loading ? (
        <p className="text-sm text-slate-500">Loading reviews…</p>
      ) : fetchError ? (
        <p className="text-sm text-slate-500">Unable to load reviews. Please try again later.</p>
      ) : reviews.length === 0 ? (
        <div className="text-center py-10 bg-slate-50 rounded-xl">
          <p className="text-slate-500 text-sm">No reviews yet. Be the first to share your experience!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <div key={review.id} className="bg-white border rounded-xl p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-sm text-slate-900">{review.customer_name}</p>
                  <StarRating rating={review.rating} />
                </div>
                <span className="text-xs text-slate-400">
                  {new Date(review.created_at).toLocaleDateString()}
                </span>
              </div>
              {review.comment && (
                <p className="text-sm text-slate-600">{review.comment}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
