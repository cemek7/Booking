'use client';

import { useState } from 'react';
import StarRating from '@/components/StarRating';

interface ReviewPromptProps {
  slug: string;
  reservationId?: string;
}

export default function ReviewPrompt({ slug, reservationId }: ReviewPromptProps) {
  const [state, setState] = useState<'prompt' | 'form' | 'done'>('prompt');
  const [form, setForm] = useState({ customer_name: '', rating: 5, comment: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  if (state === 'done') {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 text-center">
        ✓ Thank you for your review!
      </div>
    );
  }

  if (state === 'prompt') {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center space-y-2">
        <p className="text-sm font-medium text-yellow-900">How was your experience?</p>
        <p className="text-xs text-yellow-700">Leave a quick review to help others discover us.</p>
        <div className="flex justify-center gap-2 pt-1">
          <button
            onClick={() => setState('form')}
            className="px-4 py-1.5 bg-yellow-500 text-white text-sm rounded-lg hover:bg-yellow-600"
          >
            Leave a Review
          </button>
          <button
            onClick={() => setState('done')}
            className="px-4 py-1.5 border text-sm rounded-lg text-gray-500 hover:bg-gray-50"
          >
            Skip
          </button>
        </div>
      </div>
    );
  }

  async function submit() {
    if (!form.customer_name.trim()) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      const res = await fetch(`/api/public/${slug}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          reservation_id: reservationId,
        }),
      });
      if (res.ok) {
        setState('done');
      } else {
        setSubmitError(true);
      }
    } catch {
      setSubmitError(true);
    }
    finally { setSubmitting(false); }
  }

  return (
    <div className="border rounded-xl p-4 space-y-3 text-left">
      <h3 className="font-medium text-sm text-center">Leave a Review</h3>
      <StarRating rating={form.rating} interactive onChange={(r) => setForm((f) => ({ ...f, rating: r }))} />
      <input
        value={form.customer_name}
        onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))}
        className="w-full border rounded-lg px-3 py-2 text-sm"
        placeholder="Your name"
      />
      <textarea
        value={form.comment}
        onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
        rows={2}
        className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
        placeholder="Share your experience (optional)"
      />
      {submitError && (
        <p className="text-xs text-red-600">Failed to submit. Please try again.</p>
      )}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={submitting || !form.customer_name.trim()}
          className="flex-1 py-2 bg-indigo-600 text-white text-sm rounded-lg disabled:opacity-60"
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
        <button
          onClick={() => setState('done')}
          className="px-4 py-2 border text-sm rounded-lg hover:bg-gray-50"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
