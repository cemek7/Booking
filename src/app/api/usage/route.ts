import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { ensureTenantHasQuota } from '@/lib/llmQuota';

// GET /api/usage?tenant_id=... -> returns trailing 7 days usage + quota status
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenant_id');
  if (!tenantId) return NextResponse.json({ error: 'tenant_id_required' }, { status: 400 });
  const supabase = createServerSupabaseClient();
  const today = new Date();
  const startRange = new Date();
  startRange.setUTCDate(startRange.getUTCDate() - 6); // inclusive 7-day window
  startRange.setUTCHours(0,0,0,0);
  const startIso = startRange.toISOString().substring(0,10); // date part
  const { data, error } = await supabase
    .from('usage_daily')
    .select('day, bookings, deposits, llm_tokens')
    .eq('tenant_id', tenantId)
    .gte('day', startIso)
    .order('day', { ascending: true });
  const quota = await ensureTenantHasQuota(supabase, tenantId);
  if (error) {
    return NextResponse.json({ error: 'usage_lookup_failed', quota }, { status: 500 });
  }
  // Normalize to ensure all days present
  const days: Record<string, { bookings: number; deposits: number; llm_tokens: number }> = {};
  for (let i=0;i<7;i++) {
    const d = new Date(startRange.getTime()); d.setUTCDate(startRange.getUTCDate()+i);
    const k = d.toISOString().substring(0,10);
    days[k] = { bookings:0, deposits:0, llm_tokens:0 };
  }
  (data||[]).forEach(row => {
    if (row.day && days[row.day]) days[row.day] = { bookings: row.bookings||0, deposits: row.deposits||0, llm_tokens: row.llm_tokens||0 };
  });
  return NextResponse.json({ window: Object.entries(days).map(([day,vals]) => ({ day, ...vals })), quota });
}
