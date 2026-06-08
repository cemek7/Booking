import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { defaultLogger } from '@/lib/logger';
import type { ProviderConfig, WhatsAppProviderClient } from './types';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export class InstagramAdapter implements WhatsAppProviderClient {
  constructor(private cfg: ProviderConfig) {}

  private headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.cfg.apiKey}`,
    };
  }

  private messageEndpoint(): string {
    return `${trimTrailingSlash(this.cfg.baseUrl)}/${this.cfg.instanceName}/messages`;
  }

  async createInstance(_webhookUrl: string, _webhookSecret: string) {
    return { status: 'configured' };
  }

  async getConnectionStatus() {
    try {
      const res = await fetchWithTimeout(
        `${trimTrailingSlash(this.cfg.baseUrl)}/${this.cfg.instanceName}?fields=username`,
        { headers: { Authorization: `Bearer ${this.cfg.apiKey}` }, timeoutMs: 10_000 }
      );
      return { connected: res.ok };
    } catch {
      return { connected: false };
    }
  }

  async getQrCode(): Promise<string | null> {
    return null;
  }

  async requestPairingCode(_phoneNumber: string): Promise<string | null> {
    return null;
  }

  async deleteInstance(): Promise<void> {
    return;
  }

  async sendTextMessage(to: string, text: string, _quotedMessageId?: string) {
    try {
      const payload = {
        recipient: { id: to },
        message: { text },
      };

      const res = await fetchWithTimeout(this.messageEndpoint(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
        timeoutMs: 15_000,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        defaultLogger.error('[InstagramAdapter] sendTextMessage failed', {
          status: res.status,
          body: body.slice(0, 500),
          endpoint: this.messageEndpoint(),
        });
        return { success: false };
      }

      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      const messageId = typeof data.message_id === 'string' ? data.message_id : undefined;
      return { success: true, messageId };
    } catch {
      return { success: false };
    }
  }

  async sendMediaMessage(
    to: string,
    media: { url: string; mimetype?: string; filename?: string },
    _caption?: string,
    type: 'image' | 'document' | 'audio' | 'video' = 'image'
  ) {
    try {
      const payload = {
        recipient: { id: to },
        message: {
          attachment: {
            type,
            payload: { url: media.url },
          },
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
        defaultLogger.error('[InstagramAdapter] sendMediaMessage failed', {
          status: res.status,
          body: body.slice(0, 500),
          endpoint: this.messageEndpoint(),
        });
        return { success: false };
      }

      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      const messageId = typeof data.message_id === 'string' ? data.message_id : undefined;
      return { success: true, messageId };
    } catch {
      return { success: false };
    }
  }
}
