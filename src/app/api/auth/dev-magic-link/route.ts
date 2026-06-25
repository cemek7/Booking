export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const BodySchema = z.object({
  email: z.string().email(),
  redirectTo: z.string().url().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const host = request.nextUrl.hostname;
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';

  if (process.env.NODE_ENV === 'production' && !isLocalHost) {
    return NextResponse.json({ error: 'not_available_in_production' }, { status: 404 });
  }

  try {
    const body = BodySchema.parse(await request.json());
    const admin = createSupabaseAdminClient();
    const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL;
    const isLocalHost = request.nextUrl.hostname === 'localhost' || request.nextUrl.hostname === '127.0.0.1';
    const baseUrl = body.redirectTo ? null : (isLocalHost ? request.nextUrl.origin : (configuredAppUrl || request.nextUrl.origin));
    const redirectUrl = new URL('/auth/callback', String(baseUrl || request.nextUrl.origin));
    redirectUrl.searchParams.set('finalize', '1');
    const redirectTo = body.redirectTo || redirectUrl.toString();

    const { data, error } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: body.email,
      options: { redirectTo },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const actionLink = data?.properties?.action_link || null;
    if (!actionLink) {
      return NextResponse.json({ error: 'missing_action_link' }, { status: 500 });
    }

    return NextResponse.json({
      action_link: actionLink,
      email_otp: data?.properties?.email_otp ?? null,
      redirect_to: data?.properties?.redirect_to ?? redirectTo,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid_request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
