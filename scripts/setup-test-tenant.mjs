#!/usr/bin/env node
/**
 * setup-test-tenant.mjs
 *
 * Creates a test user + tenant + whatsapp_configurations row for local E2E testing.
 * Run: node scripts/setup-test-tenant.mjs
 *
 * Reads from .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Load .env.local
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env.local');

const env = {};
try {
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    env[key] = value;
  }
} catch (err) {
  console.error('Could not read .env.local:', err.message);
  process.exit(1);
}

const SUPABASE_URL = env['NEXT_PUBLIC_SUPABASE_URL'];
const SERVICE_ROLE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'];

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
  'apikey': SERVICE_ROLE_KEY,
};

async function supabaseRequest(path, method, body) {
  const url = `${SUPABASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const TEST_EMAIL = process.env.TEST_EMAIL || 'chrisdavies250@gmail.com';
const TENANT_ID = randomUUID();

console.log('\n=== Boka Test Tenant Setup ===\n');

// 1. Create auth user (auto-confirmed)
console.log('1. Creating auth user...');
let userId;
try {
  const createUser = async (withPassword) => supabaseRequest('/auth/v1/admin/users', 'POST', {
    email: TEST_EMAIL,
    ...(withPassword ? { password: withPassword } : {}),
    email_confirm: true,
  });

  try {
    const authData = await createUser(null);
    userId = authData.id;
  } catch {
    const fallbackPassword = `tmp-${randomUUID()}-${randomUUID()}`;
    const authData = await createUser(fallbackPassword);
    userId = authData.id;
  }
  console.log(`   ✓ User created: ${userId}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('already been registered') || message.includes('already exists')) {
    const users = await supabaseRequest(`/auth/v1/admin/users?email=${encodeURIComponent(TEST_EMAIL)}`, 'GET');
    const existing = Array.isArray(users) ? users[0] : users?.users?.[0];
    if (!existing) {
      console.error('   ✗ User already exists but could not fetch it:', message);
      process.exit(1);
    }
    userId = existing.id;
    console.log(`   ~ User already exists: ${userId}`);
  } else {
    console.error('   ✗ Failed to create user:', message);
    process.exit(1);
  }
}

// 2. Insert tenant
console.log('2. Inserting tenant...');
try {
  await supabaseRequest('/rest/v1/tenants', 'POST', {
    id: TENANT_ID,
    name: 'Test Salon',
  });
  console.log(`   ✓ Tenant created: ${TENANT_ID}`);
} catch (err) {
  console.error('   ✗ Failed to insert tenant:', err.message);
  process.exit(1);
}

// 3. Insert tenant_users
console.log('3. Inserting tenant_users...');
try {
  await supabaseRequest('/rest/v1/tenant_users', 'POST', {
    user_id: userId,
    tenant_id: TENANT_ID,
    role: 'owner',
  });
  console.log('   ✓ tenant_users row created');
} catch (err) {
  console.error('   ✗ Failed to insert tenant_users:', err.message);
  process.exit(1);
}

// 4. Insert whatsapp_configurations
console.log('4. Inserting whatsapp_configurations...');
try {
  await supabaseRequest('/rest/v1/whatsapp_configurations', 'POST', {
    tenant_id: TENANT_ID,
    instance_name: 'boka_instance',
    evolution_base_url: 'http://localhost:8080',
    evolution_api_key: '429683C4C977415CAAFCCE10F7D57E11',
    webhook_url: 'http://localhost:3000/api/webhooks/whatsapp',
    active: true,
    agent_enabled: false,
  });
  console.log('   ✓ whatsapp_configurations row created (agent_enabled=false)');
} catch (err) {
  console.warn('   ~ Insert failed, trying to update existing boka_instance row:', err.message);
  try {
    await supabaseRequest('/rest/v1/whatsapp_configurations?instance_name=eq.boka_instance', 'PATCH', {
      tenant_id: TENANT_ID,
      evolution_base_url: 'http://localhost:8080',
      evolution_api_key: '429683C4C977415CAAFCCE10F7D57E11',
      webhook_url: 'http://localhost:3000/api/webhooks/whatsapp',
      active: true,
      agent_enabled: false,
    });
    console.log('   ✓ Existing whatsapp_configurations row updated to point at the new tenant');
  } catch (updateErr) {
    console.error('   ✗ Failed to update existing whatsapp_configurations row:', updateErr.message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n=== Setup Complete ===');
console.log(`  Tenant ID : ${TENANT_ID}`);
console.log(`  Email     : ${TEST_EMAIL}`);
console.log(`  User ID   : ${userId}`);
console.log('\nNext steps:');
console.log('  1. npm run dev  (in /Booking)');
console.log(`  2. Sign in with the magic link sent to ${TEST_EMAIL}`);
console.log('  3. Run Test A webhook curl (agent_enabled=false → no AI reply)');
console.log('  4. UPDATE whatsapp_configurations SET agent_enabled=true WHERE instance_name=\'boka_instance\'');
console.log('  5. Run Test B webhook curl → trigger /api/jobs/process → AI reply in dashboard');
console.log('  6. Login at http://localhost:3000/auth/signin\n');
