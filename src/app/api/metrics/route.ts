import { metricsText } from '@/lib/metrics';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const metricsSecret = process.env.METRICS_SECRET;
  if (metricsSecret) {
    const authHeader = request.headers.get('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (token !== metricsSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const body = await metricsText();
    return new Response(body, { headers: { 'Content-Type': 'text/plain; version=0.0.4' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve metrics';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
