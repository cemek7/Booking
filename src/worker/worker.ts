import { MessagingAdapter } from '@/lib/messagingAdapter';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { JobPayload } from '@/types/jobs';

// Generic worker handler entrypoint; loaded by workerRunner dynamic import.
export async function handler(payload: JobPayload | null) {
  if (!payload) return null;
  const supabase = createServerSupabaseClient();
  const type = (payload as any).type || null;
  if (type === 'send_reminder') {
    const reminderId = (payload as any).reminder_id as string | undefined;
    if (!reminderId) return { error: 'missing_reminder_id' };
    // fetch reminder row
    const { data: reminder } = await supabase.from('reminders').select('*').eq('id', reminderId).maybeSingle();
    if (!reminder) return { error: 'reminder_not_found' };
    // basic expiration guard
    if (reminder.status !== 'pending') return { info: 'already_processed' };
    const adapter = new MessagingAdapter();
    const to = (reminder as any).raw?.phone || (reminder as any).phone || null;
    if (!to) {
      // mark failed due to no target
      await supabase.from('reminders').update({ status: 'failed', attempts: (reminder.attempts || 0) + 1, raw: { reason: 'no_target' } }).eq('id', reminderId);
      return { error: 'no_target' };
    }
    const body = `Reminder: upcoming booking at ${(reminder as any).remind_at}`;
    const sendRes = await adapter.sendMessage({ tenant_id: reminder.tenant_id, channel: (reminder.method || 'whatsapp'), to, body });
    const newStatus = sendRes.status === 'sent' ? 'sent' : 'failed';
    await supabase.from('reminders').update({ status: newStatus, attempts: (reminder.attempts || 0) + 1 }).eq('id', reminderId);
    return { reminder_id: reminderId, status: newStatus };
  }
  // Unknown job types are ignored gracefully
  return { skipped: true };
}

export default { handler };
