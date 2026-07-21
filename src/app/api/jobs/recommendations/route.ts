import { NextResponse } from 'next/server';
import { runRecommendationCycleWithAdmin } from '@/lib/recommendations/job';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (
    process.env.NODE_ENV === 'production' &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runRecommendationCycleWithAdmin(new Date());
  return NextResponse.json(result);
}
