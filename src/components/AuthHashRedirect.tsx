"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Detects Supabase implicit-flow tokens in the URL hash (e.g. from invite emails
 * that redirect to the site root instead of /booka/auth/callback) and forwards them.
 */
export default function AuthHashRedirect() {
  const router = useRouter();

  useEffect(() => {
    const pathname = window.location.pathname;
    const search = window.location.search;
    const hash = window.location.hash;

    if (pathname !== "/auth/callback" && pathname !== "/booka/auth/callback" && search && new URLSearchParams(search).has("code")) {
      // Full page load so the browser callback page receives the code and can
      // hand it off to the server exchange route.
      window.location.replace(`/booka/auth/callback${search}${hash}`);
      return;
    }

    if (hash && hash.includes("access_token=")) {
      // Full page load so the Supabase singleton initialises fresh on /booka/auth/callback
      // with the hash in the URL and auto-detects the session correctly.
      window.location.replace(`/booka/auth/callback${hash}`);
    }
  }, [router]);

  return null;
}
