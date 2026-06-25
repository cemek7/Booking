import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { type NextApiRequest, type NextApiResponse } from 'next';
import { serialize } from 'cookie';
import { defaultLogger } from '@/lib/logger';

type CookieAdapter = {
  get: (name: string) => string | undefined | Promise<string | undefined>;
  set: (name: string, value: string, options: CookieOptions) => void | Promise<void>;
  remove: (name: string, options: CookieOptions) => void | Promise<void>;
};

/**
 * Helper function to get existing cookies from a response as an array,
 * optionally excluding a specific cookie name to prevent duplicates.
 *
 * @param res - The NextApiResponse object containing the Set-Cookie header
 * @param excludeName - Optional cookie name to exclude from the returned array
 * @returns Array of cookie strings from the Set-Cookie header
 */
function getFilteredExistingCookies(
  res: NextApiResponse,
  excludeName?: string
): string[] {
  const existingCookies = res.getHeader('Set-Cookie');
  const cookiesArray = Array.isArray(existingCookies)
    ? existingCookies
    : existingCookies
      ? [existingCookies.toString()]
      : [];
  // Filter out the cookie with the same name if excludeName is provided
  if (excludeName) {
    return cookiesArray.filter((cookie) => !cookie.startsWith(`${excludeName}=`));
  }
  return cookiesArray;
}

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
 * Options for configuring Supabase server component client behavior
 */
type ServerComponentClientOptions = {
  /**
   * When true, logs cookie operation errors instead of silently swallowing them.
   * Useful for route handlers where cookie failures should be visible.
   * Default: false (silent for Server Components)
   */
  logCookieErrors?: boolean;
};

/**
 * Creates a Supabase client for Server Component usage.
 * This needs to be created for each request.
 * 
 * @param accessToken - Optional access token to inject into the client
 * @param options - Configuration options for client behavior
 */
export function createServerSupabaseClient(
  accessToken?: string,
  options?: ServerComponentClientOptions
) {
  const shouldLogErrors = options?.logCookieErrors ?? false;

  // Build the cookie adapter up-front (no env-var access here).
  const cookieAdapter: CookieAdapter = {
    get: async (name: string) => {
      const cookieStore = await cookies();
      return cookieStore.get(name)?.value;
    },
    set: async (name: string, value: string, cookieOptions: CookieOptions) => {
      void value;
      void cookieOptions;
      if (shouldLogErrors) {
        defaultLogger.warn('Attempted cookie write from read-only server Supabase client', {
          cookieName: name,
        });
      }
    },
    remove: async (name: string, cookieOptions: CookieOptions) => {
      void cookieOptions;
      if (shouldLogErrors) {
        defaultLogger.warn('Attempted cookie removal from read-only server Supabase client', {
          cookieName: name,
        });
      }
    },
  };

  // Return a lazy proxy so that constructing this client at module-load time
  // (e.g. in module-level service singletons) does NOT throw when env vars
  // are absent during `next build`. The real Supabase client is created on
  // first property access, which only happens inside request handlers.
  let _client: ReturnType<typeof createClient> | null = null;
  const getClient = () => {
    if (!_client) _client = createClient(cookieAdapter, accessToken);
    return _client;
  };

  return new Proxy({} as ReturnType<typeof createClient>, {
    get(_target, prop: string | symbol) {
      return Reflect.get(getClient() as object, prop);
    },
  });
}

/**
 * Creates a Supabase client for API Route Handler usage.
 * This needs to be created for each request.
 */
export function getSupabaseRouteHandlerClient(accessToken?: string) {
  const cookieAdapter: CookieAdapter = {
    get: async (name: string) => {
      const cookieStore = await cookies();
      return cookieStore.get(name)?.value;
    },
    set: async (name: string, value: string, cookieOptions: CookieOptions) => {
      const cookieStore = await cookies();
      cookieStore.set({ name, value, ...cookieOptions });
    },
    remove: async (name: string, cookieOptions: CookieOptions) => {
      const cookieStore = await cookies();
      cookieStore.set({ name, value: '', ...cookieOptions });
    },
  };

  return createClient(cookieAdapter, accessToken);
}

/**
 * Helper function to append a cookie to the Set-Cookie header without overwriting existing cookies.
 * Filters out any existing cookies with the same name to prevent duplicates.
 * This is necessary for Pages API routes where multiple cookies (e.g., access and refresh tokens)
 * need to be set in a single response.
 * 
 * @param res - The NextApiResponse object
 * @param cookie - The serialized cookie string to append
 */
function appendCookie(res: NextApiResponse, cookie: string) {
  // Extract cookie name from the serialized cookie string (format: "name=value; ...")
  const cookieName = cookie.split('=')[0];
  
  // Get existing cookies, filtering out any with the same name
  const filteredCookies = getFilteredExistingCookies(res, cookieName);
  
  // Set the header with filtered cookies plus the new cookie
  res.setHeader('Set-Cookie', [...filteredCookies, cookie]);
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
  // Lazy proxy — same pattern as createServerSupabaseClient — so that module-level
  // singletons calling this function don't throw at build time when env vars
  // are absent. Validation is deferred to the first actual database call.
  let _client: ReturnType<typeof createServerClient> | null = null;

  const getAdminClient = () => {
    if (_client) return _client;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      throw new Error('Missing Supabase URL or Service Role Key for admin client');
    }
    _client = createServerClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      cookies: { get: async () => undefined, set: async () => {}, remove: async () => {} },
    });
    return _client;
  };

  return new Proxy({} as ReturnType<typeof createServerClient>, {
    get(_target, prop: string | symbol) {
      return Reflect.get(getAdminClient() as object, prop);
    },
  });
};
