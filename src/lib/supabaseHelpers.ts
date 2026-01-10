import type { SupabaseSelectArrayResult, SupabaseSelectSingleResult } from '@/types/supabase';

// Execute a query that may support `maybeSingle()` (returns single row) or
// be a raw Promise returning the typical { data, error } shape.
export async function execMaybeSingle<T = unknown>(q: unknown): Promise<SupabaseSelectSingleResult<T>> {
  try {
    // If the query object exposes maybeSingle, prefer that
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (q && typeof (q as any).maybeSingle === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (q as any).maybeSingle();
    }
    // Otherwise, if it's a thenable/promise, await it and return its value
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (q && typeof (q as any).then === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (q as any);
    }
    // Fallback: return an empty result
    return { data: null, error: null };
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { data: null, error: err as any };
  }
}

// Execute a query that may support `limit(n)` or is a raw promise. The caller
// passes the desired limit to apply if supported.
export async function execWithLimit<T = unknown>(q: unknown, n: number): Promise<SupabaseSelectArrayResult<T>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (q && typeof (q as any).limit === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (q as any).limit(n);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (q && typeof (q as any).then === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (q as any);
    }
    return { data: null, error: null };
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { data: null, error: err as any };
  }
}

const _helpers = {} as const;
export default _helpers;
