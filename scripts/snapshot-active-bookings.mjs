#!/usr/bin/env node
// Recompute active bookings gauge by counting non-cancelled, future reservations.
import { createServerSupabaseClient } from '../src/lib/supabaseClient.js';
import { bookingsActiveGauge, pushMetrics } from '../src/lib/metrics.js';

async function main() {
  let supabase;
  try { supabase = createServerSupabaseClient(); } catch (e) { console.error('Supabase client init failed', e); process.exit(1); }
  const nowIso = new Date().toISOString();
  try {
    const { data, error } = await supabase
      .from('reservations')
      .select('tenant_id')
      .gt('end_at', nowIso)
      .not('status', 'eq', 'cancelled');
    if (error) throw error;
    const counts = data.reduce((acc, row) => { const t = row.tenant_id || 'unknown'; acc[t] = (acc[t]||0)+1; return acc; }, {});
    // Reset gauge by setting each tenant count; no direct reset API, so set absolute via .set
    for (const [tenant, count] of Object.entries(counts)) {
      try { bookingsActiveGauge.set({ tenant }, count); } catch {}
    }
    await pushMetrics();
    console.log('Snapshot updated for', Object.keys(counts).length, 'tenants');
  } catch (e) {
    console.error('Failed snapshot active bookings', e);
    process.exitCode = 1;
  }
}

main();
