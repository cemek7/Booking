import { readFileSync } from 'fs';
import { join } from 'path';

describe('handoff thread continuity migration', () => {
  it.each([
    'db/migrations/158_handoff_thread_continuity.sql',
    'db/releases/2026-09-29-handoff-thread-continuity.sql',
  ])('links escalation tickets to canonical threads in %s', (relativePath) => {
    const sql = readFileSync(join(process.cwd(), relativePath), 'utf8');
    expect(sql).toMatch(/ALTER TABLE public\.escalation_queue/i);
    expect(sql).toMatch(/conversation_thread_id uuid[\s\S]+REFERENCES public\.conversation_threads\(id\)/i);
    expect(sql).toMatch(/WHERE status IN \('pending', 'claimed'\)/i);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)\b/i);
  });
});
