import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import type {
  InteractiveMessagePayload,
  ProviderConfig,
  ProviderSendResult,
  WhatsAppProviderClient,
} from './types';

export class WahaAdapter implements WhatsAppProviderClient {
  constructor(private cfg: ProviderConfig) {}

  private headers() {
    return {
      'Content-Type': 'application/json',
      'X-Api-Key': this.cfg.apiKey,
    };
  }

  private cleanPhone(number: string): string {
    return number.replace(/\D/g, '');
  }

  async createInstance(webhookUrl: string, webhookSecret: string) {
    let tenantHint: string | null = null;
    try {
      tenantHint = new URL(webhookUrl).searchParams.get('tenant_id');
    } catch {
      tenantHint = null;
    }

    const customHeaders: Array<{ name: string; value: string }> = [
      { name: 'x-evolution-secret', value: webhookSecret },
    ];
    if (tenantHint) {
      customHeaders.push({ name: 'x-booka-tenant-id', value: tenantHint });
    }

    const res = await fetchWithTimeout(`${this.cfg.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        name: this.cfg.instanceName,
        config: {
          webhooks: [
            {
              url: webhookUrl,
              events: ['message', 'session.status'],
              customHeaders,
            },
          ],
        },
      }),
      timeoutMs: 15_000,
    });
    if (!res.ok) {
      throw new Error(`WAHA createInstance error: ${res.status}`);
    }
    const data = await res.json();
    return { status: data.status ?? 'connecting' };
  }

  async getConnectionStatus() {
    try {
      const res = await fetchWithTimeout(
        `${this.cfg.baseUrl}/api/sessions/${this.cfg.instanceName}`,
        { headers: { 'X-Api-Key': this.cfg.apiKey }, timeoutMs: 10_000 }
      );
      if (!res.ok) return { connected: false };
      const data = await res.json();
      return {
        connected: data.status === 'WORKING',
        phone: data.me?.id?.replace(/@c\.us/, '') ?? undefined,
      };
    } catch {
      return { connected: false };
    }
  }

  async getQrCode(): Promise<string | null> {
    try {
      const res = await fetchWithTimeout(
        `${this.cfg.baseUrl}/api/sessions/${this.cfg.instanceName}/qr`,
        { headers: { 'X-Api-Key': this.cfg.apiKey }, timeoutMs: 10_000 }
      );
      if (!res.ok) return null;
      const data = await res.json();
      // WAHA returns { value: "data:image/png;base64,..." }
      return data.value || null;
    } catch {
      return null;
    }
  }

  async requestPairingCode(phoneNumber: string): Promise<string | null> {
    try {
      const res = await fetchWithTimeout(
        `${this.cfg.baseUrl}/api/sessions/${this.cfg.instanceName}/auth/request-code`,
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ phoneNumber: this.cleanPhone(phoneNumber) }),
          timeoutMs: 15_000,
        }
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data.code || null;
    } catch {
      return null;
    }
  }

  async deleteInstance(): Promise<void> {
    try {
      await fetchWithTimeout(
        `${this.cfg.baseUrl}/api/sessions/${this.cfg.instanceName}`,
        { method: 'DELETE', headers: { 'X-Api-Key': this.cfg.apiKey }, timeoutMs: 10_000 }
      );
    } catch {
      // fire-and-forget
    }
  }

  async sendTextMessage(to: string, text: string, _quotedMessageId?: string) {
    try {
      const res = await fetchWithTimeout(`${this.cfg.baseUrl}/api/sendText`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          session: this.cfg.instanceName,
          chatId: `${this.cleanPhone(to)}@c.us`,
          text,
        }),
        timeoutMs: 10_000,
      });
      if (!res.ok) return { success: false };
      const data = await res.json();
      return { success: true, messageId: data.id?._serialized };
    } catch {
      return { success: false };
    }
  }

  async sendTemplateMessage(_to: string, _templateName: string, _parameters?: Array<{ default: string }>) {
    return { success: false };
  }

  async sendMediaMessage(
    to: string,
    media: { url: string; mimetype: string; filename?: string },
    caption?: string,
    type: 'image' | 'document' | 'audio' | 'video' = 'image'
  ) {
    try {
      const endpoint = type === 'document' ? 'sendFile' : 'sendImage';
      const res = await fetchWithTimeout(`${this.cfg.baseUrl}/api/${endpoint}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          session: this.cfg.instanceName,
          chatId: `${this.cleanPhone(to)}@c.us`,
          file: { url: media.url, mimetype: media.mimetype, filename: media.filename },
          caption: caption || '',
        }),
        timeoutMs: 15_000,
      });
      if (!res.ok) return { success: false };
      const data = await res.json();
      return { success: true, messageId: data.id?._serialized };
    } catch {
      return { success: false };
    }
  }

  async sendInteractiveMessage(_to: string, _payload: InteractiveMessagePayload): Promise<ProviderSendResult> {
    return { success: false, reason: 'interactive_not_supported' };
  }
}
