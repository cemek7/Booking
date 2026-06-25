"use client";

import { createBrowserClient } from '@supabase/ssr';

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Creates a Supabase client for client-side (browser) usage.
 * This client is a singleton to avoid creating multiple instances.
 */
export function getSupabaseBrowserClient() {
  if (browserClient) {
    return browserClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Env vars are absent — this happens during `next build` static prerendering.
    // Return a lazy proxy so SSR of client components doesn't crash; the real
    // client will be created on first actual data access in the browser.
    return new Proxy({} as ReturnType<typeof createBrowserClient>, {
      get(_t, prop: string | symbol) {
        // Retry creating the real client on every property access
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (url && key) {
          if (!browserClient) browserClient = createBrowserClient(url, key);
          return Reflect.get(browserClient as object, prop, browserClient);
        }
        // Still no env vars — return no-ops for common Supabase methods
        if (prop === 'from') return () => ({ select: () => Promise.resolve({ data: null, error: null }), insert: () => Promise.resolve({ data: null, error: null }) });
        if (prop === 'auth') return { getUser: () => Promise.resolve({ data: { user: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) };
        return () => Promise.resolve({ data: null, error: null });
      },
    }) as ReturnType<typeof createBrowserClient>;
  }

  // Let @supabase/ssr manage browser storage directly. Custom cookie adapters
  // can break PKCE verifier persistence during redirect-based sign-in flows.
  browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey);
  
  return browserClient;
}
