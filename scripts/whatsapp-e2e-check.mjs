#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

function arg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function msBetween(a, b) {
  if (!a || !b) return null;
  return Date.parse(b) - Date.parse(a);
}

const phone = (arg('--phone') || '').replace(/\D/g, '');
const instanceName = process.env.EVOLUTION_INSTANCE_NAME;
const baseUrl = process.env.EVOLUTION_API_BASE;
const apiKey = process.env.EVOLUTION_API_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!instanceName || !baseUrl || !apiKey || !supabaseUrl || !serviceRole) {
  console.error(
    'Missing required env vars. Need EVOLUTION_INSTANCE_NAME, EVOLUTION_API_BASE, EVOLUTION_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRole);

async function main() {
  const stateRes = await fetch(`${baseUrl}/instance/connectionState/${instanceName}`, {
    headers: { apikey: apiKey },
  });
  const stateJson = await stateRes.json().catch(() => ({}));

  let inboundQuery = supabase
    .from('messages')
    .select('id,created_at,direction,from_number,to_number,content,evolution_message_id,ai_layer,tokens_used')
    .eq('direction', 'inbound')
    .eq('to_number', instanceName)
    .order('created_at', { ascending: false })
    .limit(1);

  if (phone) inboundQuery = inboundQuery.eq('from_number', phone);

  const { data: inbound } = await inboundQuery.maybeSingle();

  if (!inbound) {
    console.log(
      JSON.stringify(
        {
          connection: stateJson?.instance?.state ?? 'unknown',
          instance: instanceName,
          phone_filter: phone || null,
          message: 'No inbound messages found for this filter.',
        },
        null,
        2
      )
    );
    return;
  }

  const { data: queue } = await supabase
    .from('whatsapp_message_queue')
    .select('id,status,created_at,processed_at,retry_count,error_message')
    .eq('message_id', inbound.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: outbound } = await supabase
    .from('messages')
    .select('id,created_at,direction,from_number,to_number,content,evolution_message_id')
    .eq('direction', 'outbound')
    .eq('to_number', inbound.from_number)
    .gte('created_at', inbound.created_at)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const report = {
    connection: stateJson?.instance?.state ?? 'unknown',
    instance: instanceName,
    phone_filter: phone || null,
    inbound,
    queue,
    outbound,
    latency_ms: {
      inbound_to_queue_created: msBetween(inbound.created_at, queue?.created_at),
      queue_created_to_processed: msBetween(queue?.created_at, queue?.processed_at),
      inbound_to_outbound: msBetween(inbound.created_at, outbound?.created_at),
    },
    notes: outbound
      ? []
      : ['No outbound message yet. If connection is not open, Evolution cannot send replies.'],
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
