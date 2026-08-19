import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTelegramAlert } from '@/lib/monitoring/telegramAlert';
import { CFG } from './config';

interface GraduationCandidate {
  tenant_id: string;
  initiated_recipients_24h: number;
}

export async function runGraduationAdvisor(admin: SupabaseClient): Promise<number> {
  const threshold = CFG.graduationPerDay();
  const { data } = await admin
    .from('tenant_messaging_stats')
    .select('tenant_id, initiated_recipients_24h')
    .gte('initiated_recipients_24h', threshold);

  const candidates = (data ?? []) as GraduationCandidate[];
  for (const candidate of candidates) {
    await sendTelegramAlert(
      `Deliverability advisor: tenant ${candidate.tenant_id} reached ${candidate.initiated_recipients_24h} initiated recipients in 24h. Recommend graduating to a dedicated number.`,
    );
    // notifications columns: tenant_id, title, message, meta, read (NO type/body/metadata).
    await admin.from('notifications').insert({
      tenant_id: candidate.tenant_id,
      title: 'Dedicated number recommended',
      message: `Tenant exceeded initiated-recipient threshold (${candidate.initiated_recipients_24h}/${threshold}).`,
      meta: {
        kind: 'graduation_recommended',
        initiated_recipients_24h: candidate.initiated_recipients_24h,
        threshold,
      },
      read: false,
    });
  }

  return candidates.length;
}
