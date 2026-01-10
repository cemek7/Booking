/*
  Minimal ESM script to insert a recurring job row into Supabase via the REST API.
  Usage:
    SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=key node scripts/create-recurring-job.mjs '{"type":"process_reminders","payload":{},"interval_minutes":60}'
*/

import process from 'process';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars');
  process.exit(1);
}

const arg = process.argv[2];
if (!arg) {
  console.error('Provide a JSON payload as the first argument');
  process.exit(1);
}

let body;
try {
  body = JSON.parse(arg);
} catch (e) {
  console.error('Failed to parse JSON:', e.message);
  process.exit(1);
}

const { type, payload, interval_minutes, scheduled_at } = body;
if (!type || !payload || !interval_minutes) {
  console.error('Missing type, payload or interval_minutes in JSON');
  process.exit(1);
}

const jobPayload = { ...payload, _recurring: { interval_minutes } };
const now = new Date().toISOString();
const scheduled = scheduled_at ?? now;

const insertBody = [
  {
    type,
    payload: jobPayload,
    attempts: 0,
    status: 'pending',
    scheduled_at: scheduled,
    run_count: 0,
    created_at: now,
    updated_at: now,
  },
];

const url = `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/jobs`;

const res = await fetch(url, {
  method: 'POST',
  headers: {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  },
  body: JSON.stringify(insertBody),
});

if (!res.ok) {
  const text = await res.text();
  console.error('Insert failed', res.status, text);
  process.exit(1);
}

const data = await res.json();
console.log('Inserted job:', JSON.stringify(data, null, 2));
