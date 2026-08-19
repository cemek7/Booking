/**
 * Loads .env.local before integration tests run.
 * Uses dotenv if available; silently skips if the file doesn't exist.
 */
import * as path from 'path';
import * as fs from 'fs';

const envPath = path.resolve(process.cwd(), '.env.local');

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
  console.log(`[integration-setup] Loaded .env.local from ${envPath}`);
} else {
  console.warn(`[integration-setup] No .env.local found at ${envPath} — tests will skip if env vars are missing`);
}
