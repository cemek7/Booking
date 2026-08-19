import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY || null,
    posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || null,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null,
  });
}
