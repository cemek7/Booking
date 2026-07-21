import { NextResponse } from 'next/server';
import { runDueBriefingsWithAdmin } from '@/lib/briefings/job';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (
    process.env.NODE_ENV === 'production' &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runDueBriefingsWithAdmin(new Date());
  return NextResponse.json(result);
}
