import { createHmac, timingSafeEqual } from 'crypto';

export type StorefrontConversationContext = {
  tenantId: string;
  pageType: 'storefront' | 'service' | 'product' | 'campaign';
  serviceId?: string;
  productId?: string;
  campaignId?: string;
  referrer?: string;
  issuedAt: number;
};

const PREFIX = '#booka:';
const TTL_MS = 15 * 60 * 1000;

function secret(): string {
  return process.env.STOREFRONT_CONTEXT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'development-only-storefront-context';
}

export function createStorefrontContextToken(context: Omit<StorefrontConversationContext, 'issuedAt'>): string {
  const payload = Buffer.from(JSON.stringify({ ...context, issuedAt: Date.now() })).toString('base64url');
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function consumeStorefrontContextMarker(message: string, expectedTenantId: string): { message: string; context: StorefrontConversationContext | null } {
  const marker = new RegExp(`\\s*${PREFIX.replace('#', '\\#')}([A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+)\\s*`, 'i');
  const match = marker.exec(message);
  if (!match) return { message, context: null };
  const [payload, signature] = match[1].split('.');
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return { message: message.replace(marker, ' ').trim(), context: null };
  }
  try {
    const context = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as StorefrontConversationContext;
    if (context.tenantId !== expectedTenantId || !Number.isFinite(context.issuedAt) || Date.now() - context.issuedAt > TTL_MS) {
      return { message: message.replace(marker, ' ').trim(), context: null };
    }
    return { message: message.replace(marker, ' ').trim(), context };
  } catch {
    return { message: message.replace(marker, ' ').trim(), context: null };
  }
}
