import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { defaultLogger } from '@/lib/logger';
import type {
  InteractiveMessagePayload,
  ProviderConfig,
  ProviderSendResult,
  WhatsAppProviderClient,
} from './types';

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

  private extractMessageId(data: Record<string, unknown>): string | undefined {
    return Array.isArray(data.messages)
      ? ((data.messages[0] as { id?: string } | undefined)?.id ?? undefined)
      : undefined;
  }

  private async sendPayload(payload: Record<string, unknown>, label: string): Promise<ProviderSendResult> {
    try {
      const res = await fetchWithTimeout(this.messageEndpoint(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
        timeoutMs: 15_000,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        defaultLogger.error(`[MetaAdapter] ${label} failed`, {
          status: res.status,
          body: body.slice(0, 500),
          endpoint: this.messageEndpoint(),
        });
        return { success: false };
      }
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      return { success: true, messageId: this.extractMessageId(data) };
    } catch {
      return { success: false };
    }
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
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to: this.cleanPhone(to),
      type: 'text',
      text: { body: text },
    };
    if (quotedMessageId) {
      payload.context = { message_id: quotedMessageId };
    }
    return this.sendPayload(payload, 'sendTextMessage');
  }

  async sendTemplateMessage(
    to: string,
    templateName: string,
    parameters?: Array<{ default: string }>,
    language = 'en_US'
  ) {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to: this.cleanPhone(to),
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        components: parameters && parameters.length > 0
          ? [{
              type: 'body',
              parameters: parameters.map((item) => ({ type: 'text', text: item.default })),
            }]
          : [],
      },
    };

    return this.sendPayload(payload, 'sendTemplateMessage');
  }

  async sendMediaMessage(
    to: string,
    media: { url: string; mimetype: string; filename?: string },
    caption?: string,
    type: 'image' | 'document' | 'audio' | 'video' = 'image'
  ) {
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

    return this.sendPayload(payload, 'sendMediaMessage');
  }

  async sendInteractiveMessage(to: string, payload: InteractiveMessagePayload): Promise<ProviderSendResult> {
    const interactivePayload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to: this.cleanPhone(to),
      type: 'interactive',
      interactive: payload,
    };

    return this.sendPayload(interactivePayload, 'sendInteractiveMessage');
  }
}
