import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

type TenantMembership = {
  tenant_id: string;
  role: 'owner' | 'manager' | 'staff' | string;
  tenants?: {
    name?: string | null;
    slug?: string | null;
  } | null;
};

type CallbackFound =
  | {
      admin: true;
      email: string | null;
      user_id: string | null;
    }
  | {
      tenant_id: string;
      role: 'owner' | 'manager' | 'staff';
      email: string | null;
      user_id: string | null;
    }
  | {
      multiple: true;
      user_id: string | null;
      email: string | null;
      tenants: Array<{
        tenant_id: string;
        role: 'owner' | 'manager' | 'staff';
        name: string | null;
        slug: string | null;
      }>;
    }
  | null;

type CallbackPayload = {
  accessToken: string | null;
  userId: string | null;
  email: string | null;
  found: CallbackFound;
  redirectPath: string;
};

function normalizeInternalPath(nextPath: string | null | undefined): string | null {
  if (!nextPath) return null;
  if (!nextPath.startsWith('/')) return null;
  if (nextPath.startsWith('//')) return null;
  return nextPath;
}

function buildRedirectUrl(request: NextRequest, nextPath: string | null) {
  const baseUrl = new URL(request.url);
  return new URL(normalizeInternalPath(nextPath) || '/auth/callback?finalize=1', baseUrl);
}

function getTenantRedirectPath(role: 'owner' | 'manager' | 'staff'): string {
  if (role === 'owner') return '/dashboard';
  if (role === 'manager') return '/dashboard?role=manager';
  return '/dashboard?role=staff';
}

async function classifyUser(userId: string | null, email: string | null): Promise<CallbackFound> {
  if (!userId && !email) {
    return null;
  }

  const admin = createSupabaseAdminClient();
  const normalizedEmail = email?.trim().toLowerCase() ?? '';

  const { data: adminByEmail } = normalizedEmail
    ? await admin
        .from('admins')
        .select('email, status')
        .eq('email', normalizedEmail)
        .maybeSingle()
    : { data: null };

  const adminRow = adminByEmail;

  if (adminRow) {
    return {
      admin: true,
      email: adminRow.email ?? email,
      user_id: userId,
    };
  }

  if (!userId) {
    return null;
  }

  const { data: memberships, error } = await admin
    .from('tenant_users')
    .select('tenant_id, role, tenants(name, slug)')
    .eq('user_id', userId);

  if (error || !memberships || memberships.length === 0) {
    return null;
  }

  const validMemberships = (memberships as TenantMembership[]).filter(
    (membership) =>
      membership.role === 'owner' ||
      membership.role === 'manager' ||
      membership.role === 'staff'
  ) as Array<TenantMembership & { role: 'owner' | 'manager' | 'staff' }>;

  if (validMemberships.length === 0) {
    return null;
  }

  if (validMemberships.length === 1) {
    const membership = validMemberships[0];
    return {
      tenant_id: membership.tenant_id,
      role: membership.role,
      email,
      user_id: userId,
    };
  }

  return {
    multiple: true,
    user_id: userId,
    email,
    tenants: validMemberships.map((membership) => ({
      tenant_id: membership.tenant_id,
      role: membership.role,
      name: membership.tenants?.name ?? null,
      slug: membership.tenants?.slug ?? null,
    })),
  };
}

function buildCallbackPayload(session: {
  access_token?: string | null;
  user?: { id?: string | null; email?: string | null } | null;
} | null, found: CallbackFound): CallbackPayload {
  const accessToken = session?.access_token ?? null;
  const userId = session?.user?.id ?? null;
  const email = session?.user?.email ?? null;

  if (found && 'admin' in found) {
    return {
      accessToken,
      userId,
      email,
      found,
      redirectPath: '/dashboard/superadmin',
    };
  }

  if (found && 'multiple' in found) {
    return {
      accessToken,
      userId,
      email,
      found,
      redirectPath: '/auth/select-tenant',
    };
  }

  if (found && 'tenant_id' in found && 'role' in found) {
    return {
      accessToken,
      userId,
      email,
      found,
      redirectPath: getTenantRedirectPath(found.role),
    };
  }

  return {
    accessToken,
    userId,
    email,
    found: null,
    redirectPath: email ? '/booka/auth/onboarding' : '/booka/auth/signin',
  };
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const nextPath = normalizeInternalPath(url.searchParams.get('next'));
  const format = url.searchParams.get('format');
  const cookieWrites: Array<{ name: string; value: string; options: CookieOptions }> = [];

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase URL and Anon Key must be provided.');
    }

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: async () => request.cookies.getAll(),
        setAll: async (cookies) => {
          cookieWrites.push(...cookies);
        },
      },
    });

    let session = (await supabase.auth.getSession().catch(() => null))?.data?.session ?? null;

    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        const errorUrl = buildRedirectUrl(request, '/booka/auth/signin?auth_error=1');
        errorUrl.searchParams.set('reason', error.message);
        return NextResponse.redirect(errorUrl);
      }

      session = data?.session ?? (await supabase.auth.getSession().catch(() => null))?.data?.session ?? null;
    } else if (!session) {
      if (format === 'json') {
        return NextResponse.json(
          {
            accessToken: null,
            userId: null,
            email: null,
            found: null,
            redirectPath: '/booka/auth/signin',
          } satisfies CallbackPayload,
          { status: 200 }
        );
      }

      return NextResponse.redirect(buildRedirectUrl(request, '/booka/auth/callback?finalize=1'));
    }

    const found = await classifyUser(session?.user?.id ?? null, session?.user?.email ?? null);
    const payload = buildCallbackPayload(session, found);

    if (format === 'json') {
      const response = NextResponse.json(payload, { status: 200 });

      for (const cookie of cookieWrites) {
        response.cookies.set(cookie.name, cookie.value, cookie.options);
      }

      return response;
    }

    const response = NextResponse.redirect(buildRedirectUrl(request, nextPath || payload.redirectPath));
    for (const cookie of cookieWrites) {
      response.cookies.set(cookie.name, cookie.value, cookie.options);
    }
    return response;
  } catch (error) {
    const errorUrl = buildRedirectUrl(request, '/auth/signin?auth_error=1');
    errorUrl.searchParams.set(
      'reason',
      error instanceof Error ? error.message : 'auth_callback_failed'
    );
    return NextResponse.redirect(errorUrl);
  }
}
