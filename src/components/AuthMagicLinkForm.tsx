"use client";

import React, { useState } from "react";
import Link from "next/link";
import BrandMark from "@/components/brand/BrandMark";
import { getSupabaseBrowserClientAsync } from "@/lib/supabase/client";
import { toast } from "@/components/ui/toast";

type Props = {
  mode?: "signin" | "signup";
  redirectTo?: string;
};

function getMagicLinkRedirectPath(nextPath?: string) {
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL;
  const browserOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const browserHost = typeof window !== 'undefined' ? window.location.hostname : '';
  const isLocalHost = browserHost === 'localhost' || browserHost === '127.0.0.1';
  const baseUrl = isLocalHost ? browserOrigin : (configuredAppUrl || browserOrigin);
  const callbackUrl = new URL('/booka/auth/callback', baseUrl || browserOrigin || 'http://localhost');
  callbackUrl.searchParams.set('finalize', '1');
  if (nextPath && nextPath.startsWith('/') && !nextPath.startsWith('//')) {
    callbackUrl.searchParams.set('next', nextPath);
  }
  return callbackUrl.toString();
}

function isLocalTestingHost() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.ngrok-free.app') ||
    host.endsWith('.ngrok.app') ||
    host.endsWith('.ngrok.io')
  );
}

export default function AuthMagicLinkForm({ mode = "signin", redirectTo }: Props) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugResult, setDebugResult] = useState<string | null>(null);
  const [showLocalDebug, setShowLocalDebug] = useState(false);
  const [activity, setActivity] = useState<Array<{ kind: 'info' | 'success' | 'error'; text: string }>>([]);

  React.useEffect(() => {
    setShowLocalDebug(isLocalTestingHost());
  }, []);

  function pushActivity(kind: 'info' | 'success' | 'error', text: string) {
    setActivity((items) => [{ kind, text }, ...items].slice(0, 5));
  }

  async function generateDevMagicLink(targetEmail: string, redirect: string) {
    const res = await fetch('/api/auth/dev-magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: targetEmail,
        redirectTo: redirect,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as { error?: string })?.error || 'Failed to generate dev magic link');
    }

    const actionLink = (data as { action_link?: string }).action_link;
    if (!actionLink) throw new Error('No sign-in link returned');
    return actionLink;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);
    pushActivity('info', `Sending magic link to ${email}...`);
    toast.info(`Sending magic link to ${email}...`);

    try {
      const supabase = await getSupabaseBrowserClientAsync();
      const redirect = getMagicLinkRedirectPath(redirectTo);
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
        const rateLimited =
          /too_many_requests|rate limit/i.test(supabaseErr.message ?? '') || false;
        if (showLocalDebug && rateLimited) {
          const msg = 'Supabase rate-limited the OTP request. Please wait a moment and try again, or use a different email.';
          setError(msg);
          pushActivity('error', msg);
          toast.error(msg);
          return;
        }
        const msg = supabaseErr?.message ?? 'Unable to send magic link. Try again later.';
        setError(msg);
        pushActivity('error', msg);
        toast.error(msg);
      } else {
        const successMessage =
          `Magic link sent to ${email}. Check your inbox (and spam). The link will return you to the app.`;
        setMessage(successMessage);
        pushActivity('success', successMessage);
        toast.success(successMessage);
      }
    } catch {
      const msg = "Unable to send magic link. Try again later.";
      setError(msg);
      pushActivity('error', msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function runDebugFetch() {
    if (!showLocalDebug) return;
    setDebugResult(null);
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL as string) || '';
    if (!url) {
      const msg = 'NEXT_PUBLIC_SUPABASE_URL is not set in the browser build. Ensure env is prefixed with NEXT_PUBLIC_ and you restarted the dev server.';
      setDebugResult(msg);
      pushActivity('error', msg);
      toast.error(msg);
      return;
    }
    try {
      const res = await fetch(url, { method: 'GET' });
      const msg = `Fetch to ${url} returned status ${res.status} ${res.statusText}`;
      setDebugResult(msg);
      pushActivity('info', msg);
      toast.info(msg);
    } catch (errUnknown) {
      let errMsg = String(errUnknown);
      if (typeof errUnknown === 'object' && errUnknown !== null) {
        const maybe = errUnknown as { message?: unknown };
        if (typeof maybe.message === 'string') errMsg = maybe.message;
      }
      // Network or CORS errors surface here as TypeError
      const msg = `Fetch failed: ${errMsg}. Check network, URL, and CORS.`;
      setDebugResult(msg);
      pushActivity('error', msg);
      toast.error(msg);
    }
  }

  async function runDevMagicLink() {
    if (!showLocalDebug || !email.trim()) return;
    setLoading(true);
    setMessage(null);
    setError(null);
    setDebugResult(null);

    try {
      const actionLink = await generateDevMagicLink(email, getMagicLinkRedirectPath(redirectTo));
      setDebugResult(actionLink);
      const msg = 'Dev magic link generated. Open the link below in this browser.';
      setMessage(msg);
      pushActivity('info', msg);
      toast.info(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate dev magic link';
      setError(message);
      pushActivity('error', message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl rounded-[2rem] border border-[var(--brand-line)] bg-white/92 p-6 shadow-[0_24px_80px_rgba(16,33,26,0.08)] backdrop-blur-md sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <BrandMark variant="booka" className="h-12 w-12 shadow-sm shadow-emerald-600/20" />
          <div>
            <p className="brand-kicker text-emerald-700/65">Booka</p>
            <p className="mt-1 text-sm text-slate-500">by Techclave</p>
          </div>
        </div>

        <Link
          href="/booka"
          className="rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 text-xs font-medium text-emerald-900 transition hover:border-emerald-200 hover:bg-emerald-50"
        >
          Back to product
        </Link>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <p className="brand-kicker text-emerald-700/55">{mode === "signin" ? "Sign in" : "Create account"}</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--brand-ink)]">
            {mode === "signin" ? "Continue into Booka." : "Start your Booka setup."}
          </h2>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            Use your email to get a one-time magic link. No password, no setup friction, and the link returns you
            straight into Booka.
          </p>

          <div className="mt-5 rounded-[1.5rem] border border-emerald-100 bg-emerald-50/70 p-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700/70">
              What Booka handles
            </div>
            <ul className="space-y-2 text-sm text-slate-700">
              <li>WhatsApp and Instagram enquiries, recommendations, and sales replies</li>
              <li>Booking confirmation, reminders, and no-show follow-up</li>
              <li>Front-desk workflows for beauty, hospitality, and clinic teams</li>
            </ul>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-[1.5rem] border border-[var(--brand-line)] bg-[#fcfbf7] p-5">
          <label className="block">
            <span className="sr-only">Email</span>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#597061]">Work email</div>
            <input
              type="email"
              required
              className="w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 py-3 text-[var(--brand-ink)] shadow-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
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
              className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-5 py-3 text-sm font-medium text-white shadow-[0_12px_24px_rgba(5,150,105,0.22)] transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {loading ? "Sending…" : mode === "signin" ? "Send magic link" : "Create account"}
            </button>

            <button
              type="button"
              onClick={() => { setEmail(""); setMessage(null); setError(null); }}
              className="text-sm text-slate-600 transition hover:text-emerald-900 hover:underline"
            >
              Clear
            </button>
          </div>

          {message && <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
          {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

          {showLocalDebug && (
            <div className="mt-4 border-t border-[var(--brand-line)] pt-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#597061]">Local debug</div>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <button type="button" onClick={runDebugFetch} className="text-sm text-emerald-700 hover:underline">Test Supabase connection</button>
                <button type="button" onClick={runDevMagicLink} className="text-sm text-emerald-700 hover:underline">Generate dev magic link</button>
                <button type="button" onClick={() => { setDebugResult(null); }} className="text-sm text-slate-600 hover:underline">Clear debug</button>
              </div>
              {debugResult && (
                <div role="status" className="break-all text-xs text-slate-700">
                  {debugResult}
                </div>
              )}
            </div>
          )}

          <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700/70">
              Sign-in activity
            </div>
            {activity.length > 0 ? (
              <ul className="space-y-1 text-xs">
                {activity.map((item, index) => (
                  <li
                    key={`${item.kind}-${index}-${item.text}`}
                    className={
                      item.kind === 'error'
                        ? 'text-red-700'
                        : item.kind === 'success'
                          ? 'text-emerald-700'
                          : 'text-slate-700'
                    }
                  >
                    {item.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">No sign-in attempts yet.</p>
            )}
          </div>

          <div className="text-xs leading-6 text-slate-500">
            By continuing, you are signing into <span className="font-medium text-[var(--brand-ink)]">Booka by Techclave</span>.
          </div>
        </form>
      </div>
    </div>
  );
}
