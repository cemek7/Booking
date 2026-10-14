'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AuthMagicLinkForm from '@/components/AuthMagicLinkForm';
import { getSupabaseBrowserClientAsync } from '@/lib/supabase/client';

type InvitationStatus =
  | { valid: false }
  | {
      valid: true;
      tenant: { id: string; name: string };
      role: 'manager' | 'staff';
      masked_email: string;
      expires_at: string;
      authenticated: boolean;
      email_matches: boolean | null;
    };

function isInternalPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

export default function AcceptInvitation() {
  const router = useRouter();
  const [status, setStatus] = useState<InvitationStatus | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/invitations/status', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : { valid: false })
      .then((body: InvitationStatus) => {
        if (active) setStatus(body.valid === true ? body : { valid: false });
      })
      .catch(() => {
        if (active) setStatus({ valid: false });
      });
    return () => { active = false; };
  }, []);

  async function acceptInvitation() {
    if (accepting) return;
    setAccepting(true);
    setError(null);
    try {
      const response = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !isInternalPath(body.redirect_to)) {
        throw new Error('accept_failed');
      }
      router.replace(body.redirect_to);
    } catch {
      setError('This invitation could not be accepted. Request a new invitation from the workspace owner.');
      setAccepting(false);
    }
  }

  async function useInvitedAccount() {
    const supabase = await getSupabaseBrowserClientAsync();
    await supabase.auth.signOut();
    router.replace('/booka/auth/signin?next=%2Faccept-invite');
  }

  if (status === null) {
    return <p className="text-sm text-slate-600">Checking invitation…</p>;
  }

  if (!status.valid) {
    return (
      <div>
        <p className="text-slate-700">This invitation link is invalid or no longer available.</p>
        <Link className="mt-5 inline-block font-medium text-emerald-700 underline" href="/booka/auth/signin">
          Go to Booka sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Workspace invitation</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">{status.tenant.name}</h1>
        <p className="mt-2 text-sm text-slate-600">
          Join as <strong>{status.role}</strong> using <span>{status.masked_email}</span>.
        </p>
      </div>

      {!status.authenticated && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Sign in to accept</h2>
          <AuthMagicLinkForm mode="signin" redirectTo="/accept-invite" />
        </div>
      )}

      {status.authenticated && status.email_matches === false && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm text-amber-900">
            You are signed in with a different account. Use the invited email address to continue.
          </p>
          <button className="mt-4 font-medium text-amber-900 underline" onClick={useInvitedAccount} type="button">
            Sign out and use invited address
          </button>
        </div>
      )}

      {status.authenticated && status.email_matches === true && (
        <div>
          <button
            className="rounded-full bg-emerald-600 px-5 py-3 font-medium text-white disabled:opacity-60"
            disabled={accepting}
            onClick={acceptInvitation}
            type="button"
          >
            {accepting ? 'Accepting…' : 'Accept invitation'}
          </button>
          {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
