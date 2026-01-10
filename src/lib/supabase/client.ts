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
    // In a client component, this should not happen if env vars are set correctly
    console.error('Supabase URL and Anon Key must be provided.');
    throw new Error('Supabase URL and Anon Key must be provided.');
  }

  browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get: (name: string) => {
        if (typeof document === 'undefined') return undefined;
        const nameEQ = name + '=';
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
          let c = ca[i].trim();
          if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length);
        }
        return undefined;
      },
      set: (name: string, value: string, options: any) => {
        if (typeof document === 'undefined') return;
        let cookieStr = `${name}=${value}`;
        if (options?.maxAge) cookieStr += `; Max-Age=${options.maxAge}`;
        if (options?.expires) cookieStr += `; expires=${new Date(options.expires).toUTCString()}`;
        if (options?.path) cookieStr += `; path=${options.path}`;
        if (options?.domain) cookieStr += `; domain=${options.domain}`;
        if (options?.secure) cookieStr += '; secure';
        if (options?.sameSite) cookieStr += `; samesite=${options.sameSite}`;
        document.cookie = cookieStr;
      },
      remove: (name: string, options: any) => {
        if (typeof document === 'undefined') return;
        let cookieStr = `${name}=; Max-Age=0`;
        if (options?.path) cookieStr += `; path=${options.path}`;
        if (options?.domain) cookieStr += `; domain=${options.domain}`;
        document.cookie = cookieStr;
      },
    },
  });
  
  return browserClient;
}

// Legacy alias for backward compatibility
export const getBrowserSupabase = getSupabaseBrowserClient;
