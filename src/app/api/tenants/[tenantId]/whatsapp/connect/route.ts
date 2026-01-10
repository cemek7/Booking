import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// POST /api/tenants/:tenantId/whatsapp/connect
// Stub: marks integrationStatus as 'pending' and echoes back current settings.
export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  if (!tenantId) return NextResponse.json({ error: 'tenant_id_required' }, { status: 400 });
  try {
    // In a real implementation, validate body, enqueue provisioning job, call provider, etc.
    const supabase = createServerSupabaseClient();
    const { data: current, error: fetchErr } = await supabase
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .single();
    if (fetchErr) return NextResponse.json({ error: 'settings_fetch_failed' }, { status: 500 });
    const merged = { ...(current?.settings || {}), integrationStatus: 'pending' };
    const { error: updateErr } = await supabase
      .from('tenants')
      .update({ settings: merged })
      .eq('id', tenantId);
    if (updateErr) return NextResponse.json({ error: 'settings_update_failed' }, { status: 500 });
    return NextResponse.json({ status: 'pending', settings: merged });
  } catch {
    return NextResponse.json({ error: 'whatsapp_connect_error' }, { status: 500 });
  }
}
