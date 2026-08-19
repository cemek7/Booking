import { MessagingAdapter } from '@/lib/messagingAdapter';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { JobPayload } from '@/types/jobs';

type ReminderRow = {
  status?: string | null;
  raw?: unknown;
  phone?: string | null;
  remind_at?: string | null;
  attempts?: number | null;
  tenant_id: string;
  method?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

// Generic worker handler entrypoint; loaded by workerRunner dynamic import.
export async function handler(payload: JobPayload | null) {
  if (!payload) return null;
  const supabase = createServerSupabaseClient();
  const type = typeof payload.type === 'string' ? payload.type : null;
  if (type === 'send_reminder') {
    const reminderId = typeof payload.reminder_id === 'string' ? payload.reminder_id : undefined;
    if (!reminderId) return { error: 'missing_reminder_id' };
    // fetch reminder row
    const { data: reminder } = await supabase.from('reminders').select('*').eq('id', reminderId).maybeSingle();
    if (!reminder) return { error: 'reminder_not_found' };
    const typedReminder = reminder as ReminderRow;
    // basic expiration guard
    if (typedReminder.status !== 'pending') return { info: 'already_processed' };
    const adapter = new MessagingAdapter();
    const raw = asRecord(typedReminder.raw);
    const to = typeof raw?.phone === 'string' ? raw.phone : typedReminder.phone ?? null;
    if (!to) {
      // mark failed due to no target
      await supabase.from('reminders').update({ status: 'failed', attempts: (typedReminder.attempts || 0) + 1, raw: { reason: 'no_target' } }).eq('id', reminderId);
      return { error: 'no_target' };
    }
    const body = `Reminder: upcoming booking at ${typedReminder.remind_at ?? 'the scheduled time'}`;
    const channel = typedReminder.method === 'sms' || typedReminder.method === 'email' || typedReminder.method === 'whatsapp'
      ? typedReminder.method
      : 'whatsapp';
    const sendRes = await adapter.sendMessage({ tenant_id: typedReminder.tenant_id, channel, to, body });
    const newStatus = sendRes.status === 'sent' ? 'sent' : 'failed';
    await supabase.from('reminders').update({ status: newStatus, attempts: (typedReminder.attempts || 0) + 1 }).eq('id', reminderId);
    return { reminder_id: reminderId, status: newStatus };
  }
  // Unknown job types are ignored gracefully
  return { skipped: true };
}

export default { handler };
