'use client';

import { FormEvent, useState } from 'react';
import { useAuth } from '@/lib/supabase/auth-context';

export function AccountEmailSection() {
  const { user } = useAuth();
  const currentEmail = user?.email?.trim().toLowerCase() ?? '';
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const nextEmail = email.trim().toLowerCase();
    setMessage(null);
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (nextEmail === currentEmail) {
      setError('Enter a different email address.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/account/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: nextEmail }),
      });
      if (!response.ok) throw new Error('request_failed');
      setEmail('');
      setMessage('Check both your current and new inboxes. Your login email changes only after both links are confirmed.');
    } catch {
      setError('We could not start the email change. Try again later.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 p-4" aria-labelledby="account-email-heading">
      <h3 className="font-medium text-gray-950" id="account-email-heading">Login email</h3>
      <p className="mt-1 text-sm text-gray-600">Current verified email: {currentEmail || 'Unavailable'}</p>
      <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={submit}>
        <label className="flex-1">
          <span className="sr-only">New login email</span>
          <input
            aria-label="New login email"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="new@example.com"
            type="email"
            value={email}
          />
        </label>
        <button className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60" disabled={submitting} type="submit">
          {submitting ? 'Sending…' : 'Change login email'}
        </button>
      </form>
      {message && <p className="mt-3 text-sm text-emerald-700" role="status">{message}</p>}
      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
    </section>
  );
}
