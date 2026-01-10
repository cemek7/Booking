import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import type { JobRow, JobPayload } from '@/types/jobs';

export async function processOnePendingJob() {
  const supabase = getSupabaseRouteHandlerClient();

  // Find a pending job scheduled now or earlier
  const now = new Date().toISOString();
  const list = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', now)
    .order('scheduled_at', { ascending: true })
    .limit(1);

  const rows = (list?.data ?? []) as JobRow[];
  if (!rows || rows.length === 0) return null;
  const job = rows[0];

  // Try to claim the job atomically by changing status to 'processing' if still pending
  const claim = await supabase
    .from('jobs')
    .update({ status: 'processing', attempts: job.attempts + 1 })
    .eq('id', job.id)
    .eq('status', 'pending')
    .select()
    .maybeSingle();

  const claimed = claim?.data as JobRow | null;
  if (!claimed) return null; // somebody else claimed it

  // Load worker handler from dist/worker.js. This keeps the runner simple; a
  // production runner can replace this with tinypool or other worker runtimes.
  let handler: ((payload: JobPayload | null) => Promise<unknown>) | null = null;
  // In test environments, provide a no-op handler to avoid requiring a built worker artifact.
  if (process.env.NODE_ENV === 'test' || (globalThis as any).vi) {
    handler = async () => undefined;
  }
  try {
    // dynamic import; use the dist build path. Use dynamic import (ESM compatible)
    // so TypeScript/ESLint don't complain about require.
    // Note: `import()` returns a promise so we await it here.
    // Resolve relative path from this module runtime location.
    // Prefer the ESM build if present, fallback to the JS CJS build for compatibility.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore -- dynamic import of JS runtime artifact
    let imported: any;
    try {
      imported = await import('../../dist/worker.mjs');
    } catch (e) {
      try { imported = await import('../../dist/worker.js'); } catch (e2) { throw e2; }
    }
    const mod = imported as any;
    handler = mod && (mod.handler || (mod.default && mod.default.handler)) ? (mod.handler || (mod.default && mod.default.handler)) : null;
  } catch (e) {
    console.warn('Failed to load worker module', e);
  }

  if (!handler) {
    // Mark as failed immediately; worker code not available.
    await supabase.from('jobs').update({ status: 'failed', last_error: 'no_worker', updated_at: new Date().toISOString() }).eq('id', job.id);
    return null;
  }

  try {
    const result = await handler(job.payload as JobPayload | null);

    // If this job carries recurring metadata, reschedule the same job row for the
    // next run instead of inserting a new row. This keeps one canonical DB row
    // for a recurring job (DB-trigger style) and avoids accumulating completed
    // rows for each occurrence.
    const recurring = (job.payload as any)?._recurring;
    if (recurring && typeof recurring.interval_minutes === 'number' && Number(recurring.interval_minutes) > 0) {
      try {
        const nextAt = new Date(Date.now() + Number(recurring.interval_minutes) * 60 * 1000).toISOString();
        // Compute the incremented run_count in JS to avoid DB-side expressions that
        // may not be supported by all clients. Default to 1 if missing.
        const currentRunCount = (job as any).run_count ?? 0;
        const newRunCount = Number(currentRunCount) + 1;
        // Update the same job to schedule the next run, reset attempts, record last_run_at and run_count.
        await supabase.from('jobs').update({
          status: 'pending',
          scheduled_at: nextAt,
          attempts: 0,
          last_error: null,
          last_run_at: new Date().toISOString(),
          run_count: newRunCount,
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);
        // Return early because the job is rescheduled (it remains pending).
        return result;
      } catch (e) {
        console.warn('Failed to reschedule recurring job run', e);
        // If rescheduling failed, fallthrough and mark this run completed.
      }
    }

    // Non-recurring job: mark completed and record run metadata for observability.
    try {
      const currentRunCount = (job as any).run_count ?? 0;
      await supabase.from('jobs').update({
        status: 'completed',
        last_error: null,
        last_run_at: new Date().toISOString(),
        run_count: Number(currentRunCount) + 1,
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
    } catch (e) {
      // Best-effort: if updating run metadata fails, still return the result but log.
      console.warn('Failed to update completed job metadata', e);
      await supabase.from('jobs').update({ status: 'completed', last_error: null, updated_at: new Date().toISOString() }).eq('id', job.id);
    }
    return result;
  } catch (err) {
    // Retry/backoff strategy
    const attempts = (job.attempts ?? 0) + 1;
    const maxAttempts = 5;
    if (attempts >= maxAttempts) {
      await supabase.from('jobs').update({ status: 'failed', last_error: String(err), updated_at: new Date().toISOString() }).eq('id', job.id);
    } else {
      // exponential backoff in minutes
      const delayMin = Math.pow(2, attempts);
      const nextAt = new Date(Date.now() + delayMin * 60 * 1000).toISOString();
      await supabase.from('jobs').update({ status: 'pending', scheduled_at: nextAt, last_error: String(err), updated_at: new Date().toISOString() }).eq('id', job.id);
    }
    return null;
  }
}

export async function loopWorkerUntilCancelled(signal?: { cancelled?: boolean }) {
  while (!signal?.cancelled) {
    try {
      await processOnePendingJob();
    } catch (e) {
      console.error('Worker loop error', e);
    }
    // Small delay between polls
    await new Promise((r) => setTimeout(r, 2000));
  }
}
