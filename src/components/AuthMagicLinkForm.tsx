"use client";

import React, { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type SupabaseLite from '@/types/supabase';

type Props = {
  mode?: "signin" | "signup";
  redirectTo?: string;
};

const isDevelopment = process.env.NODE_ENV === 'development';

export default function AuthMagicLinkForm({ mode = "signin", redirectTo }: Props) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugResult, setDebugResult] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const redirect = redirectTo ?? `${window.location.origin}/auth/callback`;
      let supabaseErr: { message?: string } | null = null;
      try {
        if (typeof supabase.auth?.signInWithOtp === 'function') {
          const resp = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
          supabaseErr = resp?.error ?? null;
        } else {
          supabaseErr = { message: 'Auth client not available' };
        }
      } catch (errUnknown) {
        // Network-level errors (e.g. CORS, bad URL) often surface as a TypeError with message 'Failed to fetch'
        console.error('signInWithOtp threw', errUnknown);
        let msg = 'Unable to send magic link. Try again later.';
        if (
          typeof errUnknown === 'object' &&
          errUnknown !== null &&
          'message' in errUnknown &&
          typeof (errUnknown as { message?: unknown }).message === 'string'
        ) {
          const m = (errUnknown as { message: string }).message;
          if (m.toLowerCase().includes('failed to fetch')) {
            msg = 'Network request failed when contacting Supabase. Check NEXT_PUBLIC_SUPABASE_URL, CORS, and network connectivity.';
          } else {
            msg = m;
          }
        }
        supabaseErr = { message: msg };
      }

      if (supabaseErr) {
        setError(supabaseErr?.message ?? 'Unable to send magic link. Try again later.');
      } else {
        setMessage(
          `Magic link sent to ${email}. Check your inbox (and spam). The link will return you to the app.`
        );
      }
    } catch (err) {
      console.error(err);
      setError("Unable to send magic link. Try again later.");
    } finally {
      setLoading(false);
    }
  }

  async function runDebugFetch() {
    if (!isDevelopment) return; // Skip in production
    setDebugResult(null);
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL as string) || '';
    if (!url) {
      setDebugResult('NEXT_PUBLIC_SUPABASE_URL is not set in the browser build. Ensure env is prefixed with NEXT_PUBLIC_ and you restarted the dev server.');
      return;
    }
    try {
      const res = await fetch(url, { method: 'GET' });
      setDebugResult(`Fetch to ${url} returned status ${res.status} ${res.statusText}`);
    } catch (errUnknown) {
      let errMsg = String(errUnknown);
      if (typeof errUnknown === 'object' && errUnknown !== null) {
        const maybe = errUnknown as { message?: unknown };
        if (typeof maybe.message === 'string') errMsg = maybe.message;
      }
      // Network or CORS errors surface here as TypeError
      setDebugResult(`Fetch failed: ${errMsg}. Check network, URL, and CORS.`);
    }
  }

  return (
    <div className="max-w-md mx-auto bg-white/80 backdrop-blur-md border border-gray-200 rounded-2xl p-6 shadow-lg">
      <h2 className="text-2xl font-semibold mb-2 text-gray-900">{mode === "signin" ? "Sign in" : "Sign up"}</h2>
      <p className="text-sm text-gray-600 mb-4">Enter your email and we’ll send a one-time magic link to sign you in.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="sr-only">Email</span>
          <input
            type="email"
            required
            className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email address"
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center px-4 py-2 bg-linear-to-br from-indigo-600 to-indigo-500 text-white rounded-lg shadow-sm hover:opacity-95 disabled:opacity-60"
          >
            {loading ? "Sending…" : mode === "signin" ? "Send magic link" : "Create account"}
          </button>

          <button
            type="button"
            onClick={() => { setEmail(""); setMessage(null); setError(null); }}
            className="text-sm text-gray-600 hover:underline"
          >
            Clear
          </button>
        </div>

          {message && <div role="status" className="text-sm text-green-700">{message}</div>}
          {error && <div role="alert" className="text-sm text-red-700">{error}</div>}

          {isDevelopment && (
            <div className="mt-4 border-t pt-4">
              <div className="flex items-center gap-3 mb-2">
                <button type="button" onClick={runDebugFetch} className="text-sm text-indigo-600 hover:underline">Test Supabase connection</button>
                <button type="button" onClick={() => { setDebugResult(null); }} className="text-sm text-gray-600 hover:underline">Clear debug</button>
              </div>
              {debugResult && <div role="status" className="text-xs text-gray-700">{debugResult}</div>}
            </div>
          )}
      </form>
    </div>
  );
}
