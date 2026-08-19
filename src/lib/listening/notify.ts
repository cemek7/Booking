import { getAlertService } from '@/lib/monitoring/alerting';
import type { RawMention } from './types';

export async function notifyNewMentions(tenantId: string, mentions: RawMention[]): Promise<void> {
  if (mentions.length === 0) return;

  try {
    await getAlertService().sendInfoAlert(
      `${mentions.length} new social mention(s) to review`,
      {
        operation: 'social_listening',
        tenantId,
        metadata: { count: mentions.length },
      }
    );
  } catch {
    // Best-effort only.
  }
}
