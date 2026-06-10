import { getTenantWhatsAppConfig } from '@/lib/whatsapp/evolutionClient';
import { EvolutionAdapter } from './evolution';
import { MetaAdapter } from './meta';
import { WahaAdapter } from './waha';
import type { ProviderConfig, WhatsAppProviderClient } from './types';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function resolveDefaultWhatsAppProvider(): 'evolution' | 'waha' | 'meta' {
  const configured = process.env.DEFAULT_WHATSAPP_PROVIDER;
  if (configured === 'waha' || configured === 'meta' || configured === 'evolution') {
    return configured;
  }

  if (process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
    return 'meta';
  }

  if (process.env.WAHA_API_BASE && process.env.WAHA_API_KEY) {
    return 'waha';
  }

  return 'evolution';
}

export function buildDefaultWhatsAppProviderConfig(): ProviderConfig | null {
  const provider = resolveDefaultWhatsAppProvider();

  if (provider === 'meta') {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    if (!accessToken || !phoneNumberId) return null;
    return {
      provider: 'meta',
      baseUrl: trimTrailingSlash(process.env.WHATSAPP_BASE_URL || 'https://graph.facebook.com'),
      apiKey: accessToken,
      instanceName: phoneNumberId,
    };
  }

  if (provider === 'waha') {
    const baseUrl = trimTrailingSlash(process.env.WAHA_API_BASE || '');
    const apiKey = process.env.WAHA_API_KEY || '';
    if (!baseUrl || !apiKey) return null;
    return {
      provider: 'waha',
      baseUrl,
      apiKey,
      instanceName: 'default',
    };
  }

  const baseUrl = trimTrailingSlash(process.env.EVOLUTION_API_BASE || '');
  const apiKey = process.env.EVOLUTION_API_KEY || '';
  if (!baseUrl || !apiKey) return null;
  return {
    provider: 'evolution',
    baseUrl,
    apiKey,
    instanceName: process.env.EVOLUTION_INSTANCE_NAME || 'booka_instance',
  };
}

export function getDefaultWhatsAppProviderClient(): WhatsAppProviderClient | null {
  const config = buildDefaultWhatsAppProviderConfig();
  if (!config) return null;
  if (config.provider === 'waha') return new WahaAdapter(config);
  if (config.provider === 'meta') return new MetaAdapter(config);
  return new EvolutionAdapter(config);
}

export async function getTenantWhatsAppProviderClient(tenantId: string): Promise<WhatsAppProviderClient | null> {
  const config = await getTenantWhatsAppConfig(tenantId);
  if (!config) return null;
  if (config.provider === 'waha') return new WahaAdapter(config);
  if (config.provider === 'meta') return new MetaAdapter(config);
  return new EvolutionAdapter(config);
}
