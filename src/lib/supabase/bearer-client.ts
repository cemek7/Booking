import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function createSupabaseBearerClient(bearerToken: string): SupabaseClient {
  if (!bearerToken) {
    throw new Error('Bearer token is required to create a Supabase bearer client.');
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase URL and Anon Key must be provided.');
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    accessToken: async () => bearerToken,
  });
}
