import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { type NextApiRequest, type NextApiResponse } from 'next';
import { serialize } from 'cookie';

type CookieAdapter = {
  get: (name: string) => string | undefined | Promise<string | undefined>;
  set: (name: string, value: string, options: CookieOptions) => void | Promise<void>;
  remove: (name: string, options: CookieOptions) => void | Promise<void>;
};

function createClient(cookiesAdapter: CookieAdapter, accessToken?: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase URL and Anon Key must be provided.');
  }

  const options = {
    cookies: cookiesAdapter,
    ...(accessToken
      ? {
          global: {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        }
      : {}),
  };

  return createServerClient(supabaseUrl, supabaseAnonKey, options);
}

/**
 * Creates a Supabase client for Server Component usage.
 * This needs to be created for each request.
 */
export function getSupabaseServerComponentClient(accessToken?: string) {
  return createClient(
    {
      get: async (name: string) => {
        const cookieStore = await cookies();
        return cookieStore.get(name)?.value;
      },
      set: async (name: string, value: string, options: CookieOptions) => {
        const cookieStore = await cookies();
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // The `set` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
      remove: async (name: string, options: CookieOptions) => {
        const cookieStore = await cookies();
        try {
          cookieStore.set({ name, value: '', ...options });
        } catch {
          // The `delete` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
    },
    accessToken,
  );
}

/**
 * Creates a Supabase client for API Route Handler usage.
 * This needs to be created for each request.
 */
export function getSupabaseRouteHandlerClient(accessToken?: string) {
  return getSupabaseServerComponentClient(accessToken);
}

/**
 * Helper function to append a cookie to the Set-Cookie header without overwriting existing cookies.
 * This is necessary for Pages API routes where multiple cookies (e.g., access and refresh tokens)
 * need to be set in a single response.
 */
function appendCookie(res: NextApiResponse, cookie: string) {
  const existingCookies = res.getHeader('Set-Cookie');
  
  if (existingCookies) {
    const cookiesArray = Array.isArray(existingCookies)
      ? existingCookies
      : [existingCookies.toString()];
    res.setHeader('Set-Cookie', [...cookiesArray, cookie]);
  } else {
    res.setHeader('Set-Cookie', cookie);
  }
}

/**
 * Creates a Supabase client for Pages API Route usage.
 * This needs to be created for each request.
 *
 * @param req NextApiRequest
 * @param res NextApiResponse
 * @returns SupabaseClient
 */
export function getSupabaseApiRouteClient(
  req: NextApiRequest,
  res: NextApiResponse,
  accessToken?: string,
) {
  return createClient(
    {
      get: (name: string) => {
        return req.cookies[name];
      },
      set: (name: string, value: string, options: CookieOptions) => {
        const cookie = serialize(name, value, options);
        appendCookie(res, cookie);
      },
      remove: (name: string, options: CookieOptions) => {
        const cookie = serialize(name, '', options);
        appendCookie(res, cookie);
      },
    },
    accessToken,
  );
}

/**
 * Creates a Supabase admin client with the service role key.
 * Use this for operations that require bypassing RLS.
 */
export const createSupabaseAdminClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing Supabase URL or Service Role Key for admin client");
  }

  // For admin client, we can use createServerClient without cookies, 
  // as it will operate with the service key.
  return createServerClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    cookies: {
      get: async () => undefined,
      set: async () => {},
      remove: async () => {},
    },
  });
};

// Legacy alias for backward compatibility
export const createServerSupabaseClient = getSupabaseServerComponentClient;
