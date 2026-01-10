#!/usr/bin/env node
/*
  Dev runner to start the worker loop.

  Behavior:
  - If a compiled ESM worker exists at `dist/worker.mjs`, spawn a child
    Node process to run it (preferred, keeps ESM artifacts authoritative).
  - Otherwise, fall back to the previous behavior: attempt to require CJS
    `dist/*.js` or load the TypeScript source via `ts-node` if available.

  This keeps the dev workflow stable while allowing the repo to standardize
  on ESM `.mjs` worker artifacts.

  Usage: node scripts/run-worker.js
*/

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

async function tryImport(modulePath) {
  try { return await import(modulePath); } catch { return null; }
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');

  // Prefer ESM-built worker if available
  const esmWorker = path.join(projectRoot, 'dist', 'worker.mjs');
  if (fs.existsSync(esmWorker)) {
    // Spawn a separate Node process to run the ESM worker file. Forward
    // signals and pipe stdio so behavior is like running `node dist/worker.mjs`.
    const child = spawn(process.execPath, [esmWorker], { stdio: 'inherit' });
    child.on('exit', (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      process.exit(code === null ? 1 : code);
    });
    child.on('error', (err) => {
      console.error('Failed to spawn ESM worker', err);
      process.exit(1);
    });
    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));
    return;
  }

  // Fallback: try previous CJS dist or ts-node approach
  let runner = await tryImport(path.join(projectRoot, 'dist', 'workerRunner.js'));
  if (!runner) runner = await tryImport(path.join(projectRoot, 'dist', 'index.js')) || runner;

  if (!runner) {
    try { await tryImport('ts-node/register'); } catch { /* ignore */ }
    runner = await tryImport(path.join(projectRoot, 'src', 'lib', 'workerRunner.ts')) || await tryImport(path.join(projectRoot, 'src', 'lib', 'workerRunner'));
  }

  if (!runner) {
    console.error('Failed to load worker runner. Build project or install ts-node.');
    process.exit(1);
  }

  const { loopWorkerUntilCancelled } = runner;
  if (!loopWorkerUntilCancelled) {
    console.error('worker runner does not export loopWorkerUntilCancelled');
    process.exit(1);
  }

  const signal = { cancelled: false };
  process.on('SIGINT', () => { signal.cancelled = true; console.log('SIGINT received, shutting down worker...'); });
  process.on('SIGTERM', () => { signal.cancelled = true; console.log('SIGTERM received, shutting down worker...'); });

  (async () => {
    console.log('Starting worker loop (fallback path)');
    try {
      // Periodic metrics push if Pushgateway configured
      let pushMetricsFn = null;
      try { pushMetricsFn = (await import('../src/lib/metrics.js')).pushMetrics; } catch { /* ignore */ }
      if (process.env.PUSHGATEWAY_URL) {
        if (typeof pushMetricsFn === 'function') {
          setInterval(() => { try { pushMetricsFn(); } catch { /* ignore */ } }, 60000).unref();
        }
        console.log('Pushgateway interval enabled (60s)');
      }
      await loopWorkerUntilCancelled(signal);
    } catch (e) {
      console.error('Worker loop crashed', e);
      process.exit(1);
    }
    console.log('Worker loop exited');
    process.exit(0);
  })();
}
main();
