#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import process from 'process';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function normalizeBaseUrl(url) {
  return (url ?? '').trim().replace(/\/+$/, '');
}

function buildWebhookUrl(provider, tenantId) {
  const base = process.env.EVOLUTION_WEBHOOK_URL
    || `${process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/whatsapp`;
  if (!base) throw new Error('APP_URL or EVOLUTION_WEBHOOK_URL is required');
  const url = new URL(base);
  const cleanedPath = url.pathname.replace(/\/+$/, '');
  const webhookRoot = cleanedPath.replace(
    /\/api\/webhooks\/(?:whatsapp|evolution)(?:\/[^/]+)?$/,
    '/api/webhooks/whatsapp'
  );
  url.search = '';
  if (provider === 'waha') {
    url.pathname = `${webhookRoot}/${tenantId}`;
  } else {
    url.pathname = webhookRoot;
  }
  return url.toString();
}

function inferProvider(row) {
  if (row.provider === 'waha' || row.provider === 'evolution') return row.provider;
  return 'evolution';
}

async function supabaseRequest(url, method = 'GET', body) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const res = await fetch(`${supabaseUrl}${url}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${method} ${url} failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function syncWahaWebhook(row, webhookUrl) {
  const baseUrl = normalizeBaseUrl(row.provider_base_url || process.env.WAHA_API_BASE);
  const apiKey = row.provider_api_key || process.env.WAHA_API_KEY || '';
  const sessionName = row.instance_name || 'default';
  if (!baseUrl || !apiKey) {
    throw new Error(`WAHA credentials missing for tenant ${row.tenant_id}`);
  }

  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET || '';
  const payload = {
    name: sessionName,
    config: {
      webhooks: [
        {
          url: webhookUrl,
          events: ['message', 'session.status'],
          customHeaders: webhookSecret
            ? [{ name: 'x-evolution-secret', value: webhookSecret }]
            : [],
        },
      ],
    },
  };

  const headers = {
    'X-Api-Key': apiKey,
    'Content-Type': 'application/json',
  };

  let res = await fetch(`${baseUrl}/api/sessions/${sessionName}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    res = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WAHA webhook sync failed (${res.status}): ${text.slice(0, 400)}`);
  }

  await fetch(`${baseUrl}/api/sessions/${sessionName}/start`, {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey },
  }).catch(() => {});
}

async function syncEvolutionWebhook(row, webhookUrl) {
  const baseUrl = normalizeBaseUrl(row.provider_base_url || row.evolution_base_url || process.env.EVOLUTION_API_BASE);
  const apiKey = row.provider_api_key || row.evolution_api_key || process.env.EVOLUTION_API_KEY || '';
  const instanceName = row.instance_name;
  if (!baseUrl || !apiKey || !instanceName) {
    throw new Error(`Evolution credentials missing for tenant ${row.tenant_id}`);
  }

  const payload = {
    enabled: true,
    url: webhookUrl,
    events: ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT'],
    webhook_by_events: true,
    webhook_base64: true,
  };

  const headers = {
    apikey: apiKey,
    'Content-Type': 'application/json',
  };

  let res = await fetch(`${baseUrl}/webhook/set/${instanceName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    res = await fetch(`${baseUrl}/webhook/instance`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Evolution webhook sync failed (${res.status}): ${text.slice(0, 400)}`);
  }
}

async function main() {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  loadEnvFile(path.join(repoRoot, '.env.local'));
  loadEnvFile(path.join(repoRoot, '.env'));

  const rows = await supabaseRequest(
    '/rest/v1/whatsapp_configurations?select=id,tenant_id,provider,instance_name,provider_base_url,provider_api_key,evolution_base_url,evolution_api_key,webhook_url,active&active=eq.true',
    'GET'
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('No active whatsapp_configurations rows found.');
    return;
  }

  console.log(`Found ${rows.length} active whatsapp_configurations row(s).`);

  for (const row of rows) {
    const provider = inferProvider(row);
    const desiredWebhookUrl = buildWebhookUrl(provider, row.tenant_id);
    const desiredInstanceName = provider === 'waha' ? 'default' : row.instance_name;

    const patch = {};
    if (row.webhook_url !== desiredWebhookUrl) patch.webhook_url = desiredWebhookUrl;
    if (provider === 'waha' && row.instance_name !== 'default') patch.instance_name = 'default';

    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString();
      await supabaseRequest(`/rest/v1/whatsapp_configurations?id=eq.${row.id}`, 'PATCH', patch);
      console.log(`Updated DB webhook config for tenant ${row.tenant_id}`);
    }

    const syncRow = { ...row, instance_name: desiredInstanceName };
    if (provider === 'waha') {
      await syncWahaWebhook(syncRow, desiredWebhookUrl);
      console.log(`Synced WAHA webhook for tenant ${row.tenant_id} -> ${desiredWebhookUrl}`);
    } else {
      await syncEvolutionWebhook(syncRow, desiredWebhookUrl);
      console.log(`Synced Evolution webhook for tenant ${row.tenant_id} -> ${desiredWebhookUrl}`);
    }
  }

  console.log('Webhook sync complete.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
