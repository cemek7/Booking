export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getEnabledListeningConfigs } from '@/lib/listening/config';
import { ingestMentions } from '@/lib/listening/ingest';
import { notifyNewMentions } from '@/lib/listening/notify';
import { createListeningProvider } from '@/lib/listening/provider';

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const provider = createListeningProvider();
  const admin = createSupabaseAdminClient();
  const configs = await getEnabledListeningConfigs(admin);

  let totalNew = 0;
  for (const config of configs) {
    try {
      const fresh = await ingestMentions(admin, config, provider);
      totalNew += fresh.length;
      await notifyNewMentions(config.tenantId, fresh);
    } catch {
      // Continue processing remaining tenants.
    }
  }

  return NextResponse.json({ ok: true, tenants: configs.length, newMentions: totalNew });
}
