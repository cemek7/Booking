import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { createEvolutionClient } from '@/lib/whatsapp/evolutionClient';
import type { MessageTemplate } from '@/lib/whatsapp/evolutionClient';
import type {
  InteractiveMessagePayload,
  ProviderConfig,
  ProviderSendResult,
  WhatsAppProviderClient,
} from './types';

export class EvolutionAdapter implements WhatsAppProviderClient {
  constructor(private cfg: ProviderConfig) {}

  private get client() {
    return createEvolutionClient({
      baseUrl: this.cfg.baseUrl,
      apiKey: this.cfg.apiKey,
      instanceName: this.cfg.instanceName,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createInstance(webhookUrl: string, webhookSecret: string) {

    const client = createEvolutionClient({
      baseUrl: this.cfg.baseUrl,
      apiKey: this.cfg.apiKey,
      instanceName: this.cfg.instanceName,
      webhookUrl,
    });
    const result = await client.initializeInstance();
    return {
      qrCode: result.qrCode,
      status: result.status ?? 'connecting',
    };
  }

  async getConnectionStatus() {
    return this.client.getConnectionStatus();
  }

  async getQrCode(): Promise<string | null> {
    try {
      const res = await fetchWithTimeout(
        `${this.cfg.baseUrl}/instance/connect/${this.cfg.instanceName}`,
        { headers: { apikey: this.cfg.apiKey }, timeoutMs: 10_000 }
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data.qrcode?.base64 || data.qrcode?.code || data.qr || null;
    } catch {
      return null;
    }
  }

  async requestPairingCode(phoneNumber: string): Promise<string | null> {
    try {
      const res = await fetchWithTimeout(
        `${this.cfg.baseUrl}/instance/pairingCode/${this.cfg.instanceName}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: this.cfg.apiKey },
          body: JSON.stringify({ phoneNumber }),
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
        `${this.cfg.baseUrl}/instance/delete/${this.cfg.instanceName}`,
        { method: 'DELETE', headers: { apikey: this.cfg.apiKey }, timeoutMs: 10_000 }
      );
    } catch {
      // fire-and-forget — ignore errors
    }
  }

  async sendTextMessage(to: string, text: string, quotedMessageId?: string) {
    return this.client.sendTextMessage(to, text, quotedMessageId);
  }

  async sendTemplateMessage(to: string, templateName: string, parameters?: Array<{ default: string }>) {
    const template: MessageTemplate = {
      name: templateName,
      language: 'en_US',
      category: 'ACCOUNT_UPDATE',
      components: [
        {
          type: 'BODY',
          parameters: (parameters || []).map((item) => ({ type: 'text', text: item.default })),
        },
      ],
    };
    return this.client.sendTemplateMessage(to, template);
  }

  async sendMediaMessage(
    to: string,
    media: { url: string; mimetype: string; filename?: string },
    caption?: string,
    type: 'image' | 'document' | 'audio' | 'video' = 'image'
  ) {
    return this.client.sendMediaMessage(to, media, caption, type);
  }

  async sendInteractiveMessage(_to: string, _payload: InteractiveMessagePayload): Promise<ProviderSendResult> {
    return { success: false, reason: 'interactive_not_supported' };
  }
}
