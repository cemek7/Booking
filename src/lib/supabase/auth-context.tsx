"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';

type AuthContextType = {
  user: any | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        // dynamically import browser-only helper to avoid SSR-time evaluation
        const { getSupabaseBrowserClient } = await import('@/lib/supabase/client');
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setUser(data?.session?.user ?? null);
      } catch (e) {
        console.warn('auth init failed', e);
        if (!mounted) return;
        setUser(null);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    init();

    // subscribe to auth changes
    let listener: any = null;
    (async () => {
      try {
        const { getSupabaseBrowserClient } = await import('@/lib/supabase/client');
        const sb = typeof window !== 'undefined' ? getSupabaseBrowserClient() : null;
        if (!sb) return;
        listener = sb.auth.onAuthStateChange((event: any, session: any) => {
          setUser(session?.user ?? null);
        });
      } catch (e) {
        // ignore subscription failures in non-browser runtimes
      }
    })();

    return () => {
      mounted = false;
      try {
        // unsubscribe if listener exists
        // @ts-ignore
        listener?.data?.subscription?.unsubscribe?.();
        // @ts-ignore
        if (typeof listener === 'function') listener();
      } catch (e) {
        // ignore
      }
    };
  }, []);

  async function signOut() {
    setLoading(true);
    try {
      const { getSupabaseBrowserClient } = await import('@/lib/supabase/client');
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
      setUser(null);
    } catch (e) {
      console.warn('signOut failed', e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export default AuthProvider;
