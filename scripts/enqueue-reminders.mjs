#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

// Small long-running process that periodically enqueues a `process_reminders`
// job row into the `jobs` table. Intended to run as a lightweight service
// (no cron). Configure via environment variables:
//  - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required)
//  - ENQUEUE_INTERVAL_SECONDS (default 300)
//  - ENQUEUE_LOOKBACK_SECONDS (default interval * 2) - window to detect recent jobs
//  - REMINDERS_LIMIT (default 50) - payload.limit
//  - TENANT_ID (optional) - scope job to a tenant

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const INTERVAL = Number(process.env.ENQUEUE_INTERVAL_SECONDS || '300');
const LOOKBACK = Number(process.env.ENQUEUE_LOOKBACK_SECONDS || String(INTERVAL * 2));
const LIMIT = Number(process.env.REMINDERS_LIMIT || '50');
const TENANT_ID = process.env.TENANT_ID || null;

console.log(`enqueue-reminders: starting (interval=${INTERVAL}s, lookback=${LOOKBACK}s, limit=${LIMIT}, tenant=${TENANT_ID || 'any'})`);

let shuttingDown = false;

async function recentPendingJobExists() {
  const windowStart = new Date(Date.now() - LOOKBACK * 1000).toISOString();
  try {
    const { data, error } = await supabase
      .from('jobs')
      .select('id')
      .in('type', ['process_reminders'])
      .in('status', ['pending', 'processing'])
      .gte('created_at', windowStart)
      .limit(1);
    if (error) {
      console.warn('check recentPendingJobExists query error', error);
      return false; // fail open so we still try to enqueue
    }
    return Array.isArray(data) && data.length > 0;
  } catch (e) {
    console.error('recentPendingJobExists error', e);
    return false;
  }
}

async function enqueueJob() {
  const payload = { job_type: 'process_reminders', tenant_id: TENANT_ID, limit: LIMIT };
  const row = { type: 'process_reminders', payload, status: 'pending', attempts: 0, scheduled_at: new Date().toISOString() };
  try {
    const { data, error } = await supabase.from('jobs').insert([row]).select().maybeSingle();
    if (error) {
      console.error('failed to insert job', error);
      return false;
    }
    console.log('enqueued job', data?.id || '(inserted)');
    return true;
  } catch (e) {
    console.error('enqueueJob failed', e);
    return false;
  }
}

async function tick() {
  if (shuttingDown) return;
  try {
    const exists = await recentPendingJobExists();
    if (exists) {
      console.log('recent pending/processing job exists, skipping enqueue');
      return;
    }
    await enqueueJob();
  } catch (e) {
    console.error('tick error', e);
  }
}

// initial immediate run
tick();

const handle = setInterval(() => { void tick(); }, INTERVAL * 1000);

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('enqueue-reminders: shutting down');
  clearInterval(handle);
  // allow inflight tick to finish briefly then exit
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => { console.error('uncaughtException', err); shutdown(); });

/*
Usage examples (Windows PowerShell):

  $Env:SUPABASE_URL = 'https://...'; $Env:SUPABASE_SERVICE_ROLE_KEY = '...'; node .\scripts\enqueue-reminders.mjs

Or via npm script: npm run enqueue:reminders
*/
