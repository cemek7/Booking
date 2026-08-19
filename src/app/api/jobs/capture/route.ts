import { NextResponse } from 'next/server';
import { runCaptureQueueWithAdmin } from '@/lib/capture/jobRunner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV === 'production' && (!cronSecret || authHeader !== `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(25, Number(url.searchParams.get('limit') ?? 10) || 10));
  const result = await runCaptureQueueWithAdmin(limit);
  return NextResponse.json(result);
}
