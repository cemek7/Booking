"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type SupabaseLite from '@/types/supabase';

export default function AuthNav() {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
  const sb = getSupabaseBrowserClient() as unknown as SupabaseLite;
  const sessionRes = await sb.auth?.getSession?.();
  const session = (sessionRes as { data?: { session?: { user?: { email?: string } } } } | null)?.data?.session ?? null;
        if (!mounted) return;
        setEmail(session?.user?.email ?? null);
      } catch (err) {
        console.error("AuthNav: unable to read session", err);
      }
    }
    load();

    const sb2 = getSupabaseBrowserClient() as unknown as SupabaseLite;
    const { data: sub } = sb2.auth?.onAuthStateChange?.((_event, session) => {
      const s = (session as { user?: { email?: string } } | null) ?? null;
      setEmail(s?.user?.email ?? null);
    }) ?? { data: { subscription: undefined } };

    return () => {
      mounted = false;
      try { sub?.subscription?.unsubscribe?.(); } catch {}
    };
  }, []);

  async function handleSignOut() {
    setLoading(true);
    try {
  const sb3 = getSupabaseBrowserClient() as unknown as SupabaseLite;
  await sb3.auth?.signOut?.();
      // client will update via onAuthStateChange
      setEmail(null);
    } catch (err) {
      console.error("Sign out error", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      {email ? (
        <>
          <span className="text-sm text-gray-700">{email}</span>
          <button
            onClick={handleSignOut}
            disabled={loading}
            className="text-sm px-3 py-1 bg-white border rounded-md shadow-sm hover:bg-gray-50"
          >
            Sign out
          </button>
        </>
      ) : (
        <Link href="/auth/signin" className="text-sm px-3 py-1 bg-indigo-600 text-white rounded-md shadow-sm">
          Sign in
        </Link>
      )}
    </div>
  );
}
