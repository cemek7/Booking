import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { isTenantOnboardingIncomplete } from '@/lib/onboarding/state';
import { resolveActiveGlobalAdmin } from '@/lib/auth/global-admin';

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
      onboarding_incomplete?: boolean;
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

function firstForwardedValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first || null;
}

function isInternalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function getPublicOrigin(request: NextRequest): string {
  const forwardedHost = firstForwardedValue(request.headers.get('x-forwarded-host'));
  const forwardedProto = firstForwardedValue(request.headers.get('x-forwarded-proto'));

  if (forwardedHost) {
    return `${forwardedProto || 'https'}://${forwardedHost}`;
  }

  const requestUrl = new URL(request.url);
  if (!isInternalHostname(requestUrl.hostname)) {
    return requestUrl.origin;
  }

  const configuredOrigin =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_BASE_URL;

  if (configuredOrigin) {
    return configuredOrigin.replace(/\/+$/, '');
  }

  return requestUrl.origin;
}

function buildRedirectUrl(request: NextRequest, nextPath: string | null) {
  return new URL(
    normalizeInternalPath(nextPath) || '/auth/callback?finalize=1',
    getPublicOrigin(request)
  );
}

function getTenantRedirectPath(role: 'owner' | 'manager' | 'staff'): string {
  // One home per role: owner/manager share the merged /dashboard,
  // staff have their dedicated staff-dashboard.
  if (role === 'staff') return '/dashboard/staff-dashboard';
  return '/dashboard';
}

async function classifyUser(userId: string | null, email: string | null): Promise<CallbackFound> {
  if (!userId && !email) {
    return null;
  }

  const admin = createSupabaseAdminClient();
  const adminRow = await resolveActiveGlobalAdmin(admin, email);

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
    const { data: tenant } = await admin
      .from('tenants')
      .select('settings, metadata')
      .eq('id', membership.tenant_id)
      .maybeSingle();

    return {
      tenant_id: membership.tenant_id,
      role: membership.role,
      email,
      user_id: userId,
      onboarding_incomplete: isTenantOnboardingIncomplete(tenant),
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
      redirectPath: found.onboarding_incomplete ? '/booka/auth/onboarding?resume=1' : getTenantRedirectPath(found.role),
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
