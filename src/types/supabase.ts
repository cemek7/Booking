// Minimal supabase-lite types used across the app to avoid importing full SDK types
// These types model the small chainable query surface and auth helpers we use in the UI.

// Generic select result for queries that return arrays
export type SupabaseSelectArrayResult<T> = { data?: T[] | null; error?: { message?: string } | null }

// Generic single-row result
export type SupabaseSelectSingleResult<T> = { data?: T | null; error?: { message?: string } | null }

// A chainable query executor that is awaitable (so you can `await sb.from(...).select(...).eq(...).order(...).limit(...)`)
export interface SupabaseQueryExecutor<T> extends Promise<SupabaseSelectArrayResult<T>> {
  eq(key: string, value: unknown): SupabaseQueryExecutor<T>
  gte(key: string, value: unknown): SupabaseQueryExecutor<T>
  lte(key: string, value: unknown): SupabaseQueryExecutor<T>
  order(column: string, opts?: Record<string, unknown>): SupabaseQueryExecutor<T>
  limit(n: number): SupabaseQueryExecutor<T>
  // convenience helpers returning single-row results
  single(): Promise<SupabaseSelectSingleResult<T>>
  maybeSingle(): Promise<SupabaseSelectSingleResult<T>>
}

export interface SupabaseFrom<T> {
  select(cols?: string): SupabaseQueryExecutor<T>
}

export interface SupabaseChannel {
  on?: (event: string, filter: Record<string, unknown>, cb: (payload: unknown) => void) => SupabaseChannel
  subscribe?: () => Promise<unknown> | unknown
  unsubscribe?: () => void
}

// Small part of auth surface we use in UI. Keep types permissive but present so calls are type-safe.
export interface SupabaseAuth {
  getSession(): Promise<{ data?: { session?: { access_token?: string; user?: { id?: string; email?: string; user_metadata?: unknown; aud?: string } } } | null }>
  onAuthStateChange?: (cb: (...args: unknown[]) => void) => { data?: { subscription?: { unsubscribe?: () => void } } }
  signOut?: () => Promise<unknown>
  // Minimal signature used in the UI for magic-link signin
  signInWithOtp(opts: { email: string; options?: { emailRedirectTo?: string } }): Promise<{ error?: { message?: string } | null }>
}

export interface SupabaseLite {
  from: <T = unknown>(table: string) => SupabaseFrom<T>
  channel?: (name?: string) => SupabaseChannel
  removeChannel?: (ch: unknown) => void
  // required auth surface
  auth: SupabaseAuth
}

export default SupabaseLite
