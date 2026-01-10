// Simple dispatcher script to flush event_outbox rows into events table.
// Usage (PowerShell):
// $env:SUPABASE_URL="https://your.project"; $env:SUPABASE_SERVICE_ROLE_KEY="key"; node scripts/dispatch-outbox.mjs

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { existsSync } from 'fs';
import { join } from 'path';
import { config as dotenvConfig } from 'dotenv';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-otlp-http';
import { trace } from '@opentelemetry/api';
import { dispatchSuccess, dispatchFailure, observeDispatch, pushMetrics } from '../src/lib/metrics.js';

// Initialize OpenTelemetry if configured
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations()]
  });
  sdk.start();
}

// Load env from .env.local if present, else .env
const envLocal = join(process.cwd(), '.env.local');
if (existsSync(envLocal)) dotenvConfig({ path: envLocal });
else dotenvConfig();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const supabase = createServerSupabaseClient(url, key, { auth: { persistSession: false } });
const tracer = trace.getTracer('boka-dispatcher');

async function main() {
  const span = tracer.startSpan('outbox.dispatch_batch');
  const start = Date.now();
  
  try {
    const { data, error } = await supabase
      .from('event_outbox')
      .select('*')
      .is('delivered_at', null)
      .order('created_at', { ascending: true })
      .limit(100);
      
    if (error) {
      span.recordException(error);
      span.setAttribute('dispatch.status', 'fetch_error');
      console.error('Failed to load outbox rows', error);
      process.exit(1);
    }
    
    if (!data || data.length === 0) {
      span.setAttribute('dispatch.status', 'no_pending');
      span.setAttribute('dispatch.count', 0);
      console.log('No pending outbox events');
      return;
    }
    
    span.setAttribute('dispatch.pending_count', data.length);
    let dispatched = 0;
    let failed = 0;
    
    for (const row of data) {
      const itemSpan = tracer.startSpan('outbox.dispatch_item', {
        attributes: {
          'outbox.id': row.id,
          'outbox.type': row.type,
          'outbox.tenant_id': row.tenant_id || 'none'
        }
      });
      
      try {
        const insert = await supabase.from('events').insert({
          event: row.type,
          version: '1.0.0',
          tenant_id: row.tenant_id,
          location_id: row.location_id,
          payload: row.payload,
          created_at: new Date().toISOString()
        }).select('id').single();
        
        if (insert.error) throw insert.error;
        
        const upd = await supabase.from('event_outbox')
          .update({ delivered_at: new Date().toISOString() })
          .eq('id', row.id);
          
        if (upd.error) throw upd.error;
        
        itemSpan.setAttribute('dispatch.item_status', 'success');
        dispatchSuccess();
        console.log('Dispatched event_outbox row', row.id);
        dispatched += 1;
      } catch (e) {
        itemSpan.recordException(e);
        itemSpan.setAttribute('dispatch.item_status', 'failure');
        dispatchFailure();
        console.warn('Failed to dispatch row', row.id, e);
        failed += 1;
      } finally {
        itemSpan.end();
      }
    }
    
    span.setAttribute('dispatch.status', 'completed');
    span.setAttribute('dispatch.count', dispatched);
    span.setAttribute('dispatch.failed', failed);
    
    // Emit metrics for external scraping and push to Pushgateway
    console.log(`event_outbox_dispatch_count ${dispatched}`);
    console.log(`event_outbox_dispatch_failed ${failed}`);
    
    const duration = (Date.now() - start) / 1000;
    observeDispatch(duration);
    
    // Push metrics if configured
    await pushMetrics();
    
  } catch (e) {
    span.recordException(e);
    span.setAttribute('dispatch.status', 'error');
    throw e;
  } finally {
    span.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
