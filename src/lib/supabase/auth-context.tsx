"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';

type AuthUser = {
  id?: string;
  email?: string | null;
} | null;

type AuthContextType = {
  user: AuthUser;
  loading: boolean;
  signOut: () => Promise<void>;
  signIn?: (credentials: { email: string; password: string }) => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        // dynamically import browser-only helper to avoid SSR-time evaluation
        const { getSupabaseBrowserClient } = await import('@/lib/supabase/client');
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getUser();
        if (!mounted) return;
        setUser(data?.user ?? null);
      } catch (error) {
        console.warn('auth init failed', error);
        if (!mounted) return;
        setUser(null);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    init();

    // subscribe to auth changes
    let listener: { data?: { subscription?: { unsubscribe?: () => void } } } | (() => void) | null = null;
    (async () => {
      try {
        const { getSupabaseBrowserClient } = await import('@/lib/supabase/client');
        const sb = typeof window !== 'undefined' ? getSupabaseBrowserClient() : null;
        if (!sb) return;
        listener = sb.auth.onAuthStateChange((_: unknown, session: { user?: AuthUser }) => {
          setUser(session?.user ?? null);
        });
      } catch {
        // ignore subscription failures in non-browser runtimes
      }
    })();

    return () => {
      mounted = false;
      try {
        // unsubscribe if listener exists
        if (listener && typeof listener === 'object' && 'data' in listener) {
          listener.data?.subscription?.unsubscribe?.();
        }
        if (typeof listener === 'function') listener();
      } catch {
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
      if (typeof window !== 'undefined') {
        window.location.href = '/booka/auth/signin';
      }
    } catch (error) {
      console.warn('signOut failed', error);
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
