import { NextResponse } from 'next/server';
import { runRecommendationCycleWithAdmin } from '@/lib/recommendations/job';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV === 'production' && (!cronSecret || authHeader !== `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runRecommendationCycleWithAdmin(new Date());
  return NextResponse.json(result);
}
