import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';

const cwd = process.cwd();
const migrationsDir = join(cwd, 'supabase', 'migrations');
const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));

const createTableRegex = /create table if not exists\s+"?(\w+)"?/i;
const enableRlsRegex = /alter table\s+"?(\w+)"?\s+enable row level security/i;

const createdTables = new Set();
const rlsEnabledTables = new Set();

for (const file of files) {
  const content = readFileSync(join(migrationsDir, file), 'utf8');
  for (const line of content.split(/\n/)) {
    const ct = line.match(createTableRegex);
    if (ct) createdTables.add(ct[1]);
    const er = line.match(enableRlsRegex);
    if (er) rlsEnabledTables.add(er[1]);
  }
}

const missing = [...createdTables].filter(t => !rlsEnabledTables.has(t));

console.log('Tables created:', [...createdTables].sort());
console.log('Tables with RLS enabled:', [...rlsEnabledTables].sort());
console.log('Tables missing explicit RLS enable statement:', missing.sort());

// Emit a Prometheus metric line to stdout for optional scraping
try {
  const metricLine = `# TYPE rls_policies_missing_total gauge\nrls_policies_missing_total ${missing.length}`;
  console.log(metricLine);
} catch {}

// If Pushgateway configured, attempt push (best-effort)
// Pushgateway integration removed for stability; re-add later if needed.

if (missing.length > 0) {
  process.exitCode = 1;
}
