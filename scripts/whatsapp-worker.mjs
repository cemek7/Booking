#!/usr/bin/env node

/**
 * WhatsApp Worker Launcher
 *
 * The actual queue processing lives in /api/worker/whatsapp.
 * This launcher polls that route so local/dev and self-hosted runs
 * can process queue work without relying on compiled TS output.
 */

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET || 'dev-cron-secret';
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS || 5000);
const MAX_IDLE_LOGS = Number(process.env.WORKER_IDLE_LOG_EVERY || 12);

let shuttingDown = false;
let idleCount = 0;

async function runOnce() {
  const url = `${APP_URL.replace(/\/$/, '')}/api/worker/whatsapp`;
  const headers = {};
  if (process.env.NODE_ENV === 'production') {
    headers.Authorization = `Bearer ${CRON_SECRET}`;
  }

  const res = await fetch(url, { headers });
  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`worker route ${res.status}: ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function loop() {
  console.log('🚀 WhatsApp worker launcher started');
  console.log(`🔁 Polling ${APP_URL}/api/worker/whatsapp every ${POLL_INTERVAL_MS}ms`);

  while (!shuttingDown) {
    try {
      const result = await runOnce();
      const processed = Number(result?.processed ?? 0);
      const errors = Number(result?.errors ?? 0);

      if (processed > 0 || errors > 0) {
        idleCount = 0;
        console.log('✅ Worker cycle complete', result);
      } else {
        idleCount += 1;
        if (idleCount % MAX_IDLE_LOGS === 0) {
          console.log('… worker idle');
        }
      }
    } catch (error) {
      idleCount = 0;
      console.error('❌ Worker cycle failed:', error);
    }

    if (shuttingDown) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

function stop() {
  if (shuttingDown) {
    process.exit(1);
  }
  shuttingDown = true;
  console.log('🛑 Worker shutdown requested');
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGQUIT', stop);

process.on('unhandledRejection', (reason) => {
  console.error('🚫 Unhandled rejection in worker launcher:', reason);
});

loop().catch((error) => {
  console.error('💥 Fatal worker launcher error:', error);
  process.exit(1);
});

