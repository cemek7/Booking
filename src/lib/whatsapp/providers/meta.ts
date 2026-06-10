import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { defaultLogger } from '@/lib/logger';
import type { ProviderConfig, WhatsAppProviderClient } from './types';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export class MetaAdapter implements WhatsAppProviderClient {
  constructor(private cfg: ProviderConfig) {}

  private headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.cfg.apiKey}`,
    };
  }

  private cleanPhone(number: string): string {
    return number.replace(/\D/g, '');
  }

  private messageEndpoint(): string {
    return `${trimTrailingSlash(this.cfg.baseUrl)}/${this.cfg.instanceName}/messages`;
  }

  async createInstance(webhookUrl: string, webhookSecret: string) {
    void webhookUrl;
    void webhookSecret;
    return { status: 'configured' };
  }

  async getConnectionStatus() {
    try {
      const res = await fetchWithTimeout(
        `${trimTrailingSlash(this.cfg.baseUrl)}/${this.cfg.instanceName}?fields=display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${this.cfg.apiKey}` }, timeoutMs: 10_000 }
      );
      if (!res.ok) return { connected: false };
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      return {
        connected: true,
        phone: typeof data.display_phone_number === 'string' ? data.display_phone_number : undefined,
      };
    } catch {
      return { connected: false };
    }
  }

  async getQrCode(): Promise<string | null> {
    return null;
  }

  async requestPairingCode(phoneNumber: string): Promise<string | null> {
    void phoneNumber;
    return null;
  }

  async deleteInstance(): Promise<void> {
    return;
  }

  async sendTextMessage(to: string, text: string, quotedMessageId?: string) {
    try {
      const payload: Record<string, unknown> = {
        messaging_product: 'whatsapp',
        to: this.cleanPhone(to),
        type: 'text',
        text: { body: text },
      };
      if (quotedMessageId) {
        payload.context = { message_id: quotedMessageId };
      }

      const res = await fetchWithTimeout(this.messageEndpoint(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
        timeoutMs: 15_000,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        defaultLogger.error('[MetaAdapter] sendTextMessage failed', {
          status: res.status,
          body: body.slice(0, 500),
          endpoint: this.messageEndpoint(),
        });
        return { success: false };
      }
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      const messageId = Array.isArray(data.messages)
        ? ((data.messages[0] as { id?: string } | undefined)?.id ?? undefined)
        : undefined;
      return { success: true, messageId };
    } catch {
      return { success: false };
    }
  }

  async sendTemplateMessage(to: string, templateName: string, parameters?: Array<{ default: string }>) {
    try {
      const payload: Record<string, unknown> = {
        messaging_product: 'whatsapp',
        to: this.cleanPhone(to),
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en_US' },
          components: parameters && parameters.length > 0
            ? [{
                type: 'body',
                parameters: parameters.map((item) => ({ type: 'text', text: item.default })),
              }]
            : [],
        },
      };

      const res = await fetchWithTimeout(this.messageEndpoint(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
        timeoutMs: 15_000,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        defaultLogger.error('[MetaAdapter] sendTemplateMessage failed', {
          status: res.status,
          body: body.slice(0, 500),
          endpoint: this.messageEndpoint(),
        });
        return { success: false };
      }
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      const messageId = Array.isArray(data.messages)
        ? ((data.messages[0] as { id?: string } | undefined)?.id ?? undefined)
        : undefined;
      return { success: true, messageId };
    } catch {
      return { success: false };
    }
  }

  async sendMediaMessage(
    to: string,
    media: { url: string; mimetype: string; filename?: string },
    caption?: string,
    type: 'image' | 'document' | 'audio' | 'video' = 'image'
  ) {
    try {
      const payload: Record<string, unknown> = {
        messaging_product: 'whatsapp',
        to: this.cleanPhone(to),
        type,
      };

      const common = { link: media.url };
      if (type === 'image') {
        payload.image = { ...common, caption: caption || '' };
      } else if (type === 'video') {
        payload.video = { ...common, caption: caption || '' };
      } else if (type === 'audio') {
        payload.audio = common;
      } else {
        payload.document = {
          ...common,
          caption: caption || '',
          filename: media.filename || 'document',
        };
      }

      const res = await fetchWithTimeout(this.messageEndpoint(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
        timeoutMs: 15_000,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        defaultLogger.error('[MetaAdapter] sendMediaMessage failed', {
          status: res.status,
          body: body.slice(0, 500),
          endpoint: this.messageEndpoint(),
        });
        return { success: false };
      }
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      const messageId = Array.isArray(data.messages)
        ? ((data.messages[0] as { id?: string } | undefined)?.id ?? undefined)
        : undefined;
      return { success: true, messageId };
    } catch {
      return { success: false };
    }
  }
}
