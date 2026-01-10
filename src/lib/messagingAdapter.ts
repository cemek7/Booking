import { createServerSupabaseClient } from '@/lib/supabase/server';
import { redactAndTruncate } from './pii';
import metrics from './metrics';

export interface OutboundMessage {
  tenant_id: string;
  channel: 'whatsapp' | 'email' | 'sms';
  to: string;
  body: string;
  template_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SendResult {
  id: string | null;
  status: 'queued' | 'sent' | 'failed';
  provider?: string;
  error?: string | null;
}

export interface InboundMessage {
  tenant_id: string;
  from: string;
  body: string;
  raw?: Record<string, unknown> | null;
  channel: 'whatsapp' | 'email' | 'sms';
}

export interface MessagingProvider {
  name: string;
  send(out: OutboundMessage): Promise<SendResult>;
  // parse inbound provider webhook payload -> normalized message (null if unsupported)
  parseInbound?(raw: Record<string, unknown>): Promise<InboundMessage | null>;
}

function env(key: string) { return process.env[key]; }

// WhatsApp stub provider (Evolution or other API). Fails fast if credentials missing.
export class WhatsAppProvider implements MessagingProvider {
  name = 'whatsapp';
  async send(out: OutboundMessage): Promise<SendResult> {
    if (!env('WHATSAPP_API_KEY') || !env('WHATSAPP_BASE_URL')) {
      return { id: null, status: 'failed', provider: this.name, error: 'missing_credentials' };
    }
    try {
      const url = `${env('WHATSAPP_BASE_URL')}/send`;
      const payload = { to: out.to, body: redactAndTruncate(out.body, 1000), meta: out.metadata || null };
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env('WHATSAPP_API_KEY')}` },
        body: JSON.stringify(payload)
      });
      const ok = resp.ok;
      let pid: string | null = null;
      try { const j = await resp.json(); pid = j?.id || null; } catch { /* ignore */ }
      await metrics.incr('msg_out_whatsapp');
      return { id: pid, status: ok ? 'sent' : 'failed', provider: this.name, error: ok ? null : `status_${resp.status}` };
    } catch (e) {
      return { id: null, status: 'failed', provider: this.name, error: (e as Error).message };
    }
  }
}

export class EmailProvider implements MessagingProvider {
  name = 'email';
  async send(out: OutboundMessage): Promise<SendResult> {
    // Placeholder: integrate actual email provider later
    try {
      console.log('[email] send', out.to, out.body.slice(0, 80));
      await metrics.incr('msg_out_email');
      return { id: null, status: 'queued', provider: this.name };
    } catch (e) {
      return { id: null, status: 'failed', provider: this.name, error: (e as Error).message };
    }
  }
}

export interface MessagingAdapterConfig {
  whatsapp?: boolean;
  email?: boolean;
  sms?: boolean; // reserved
}

export class MessagingAdapter {
  providers: Record<string, MessagingProvider> = {};
  constructor(cfg: MessagingAdapterConfig = {}) {
    if (cfg.whatsapp !== false) this.providers.whatsapp = new WhatsAppProvider();
    if (cfg.email !== false) this.providers.email = new EmailProvider();
  }
  async sendMessage(msg: OutboundMessage): Promise<SendResult> {
    const p = this.providers[msg.channel];
    if (!p) return { id: null, status: 'failed', error: 'channel_not_enabled' };
    return await p.send(msg);
  }
}

// Persist outbound message row (best-effort) for auditing; caller supplies tenant scoping.
export async function logOutboundMessage(supabase: SupabaseClient, result: SendResult, original: OutboundMessage) {
  try {
    await supabase.from('messages').insert({
      tenant_id: original.tenant_id,
      from_number: null,
      to_number: original.to,
      content: original.body,
      direction: 'outbound',
      raw: { provider: result.provider, status: result.status, error: result.error },
    });
  } catch (e) {
    console.warn('logOutboundMessage failed', e);
  }
}

export default { MessagingAdapter, WhatsAppProvider, EmailProvider, logOutboundMessage };
