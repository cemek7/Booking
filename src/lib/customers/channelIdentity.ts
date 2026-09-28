import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { normalizePhone } from './identity';

export type CustomerChannel = 'whatsapp' | 'instagram';

type ChannelIdentityRow = {
  id: string;
  tenantId: string;
  customerId: string;
  channel: CustomerChannel;
  externalId: string;
};

export interface ChannelIdentityResolution {
  identityId: string;
  customerId: string;
  created: boolean;
}

export interface ChannelIdentityStore {
  findIdentity(
    tenantId: string,
    channel: CustomerChannel,
    externalId: string,
  ): Promise<ChannelIdentityRow | null>;
  findCustomerByNormalizedPhone(tenantId: string, normalizedPhone: string): Promise<string | null>;
  createCustomer(input: {
    tenantId: string;
    displayName: string;
    phone: string | null;
    normalizedPhone: string | null;
    source: string;
  }): Promise<string>;
  createIdentity(input: {
    tenantId: string;
    customerId: string;
    channel: CustomerChannel;
    externalId: string;
  }): Promise<ChannelIdentityRow>;
  deleteUnreferencedCustomer(customerId: string, tenantId: string): Promise<void>;
}

function mapIdentity(row: Record<string, unknown>): ChannelIdentityRow {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    customerId: String(row.customer_id),
    channel: row.channel as CustomerChannel,
    externalId: String(row.external_id),
  };
}

function createChannelIdentityStore(): ChannelIdentityStore {
  const admin = createSupabaseAdminClient();

  return {
    async findIdentity(tenantId, channel, externalId) {
      const { data, error } = await admin
        .from('customer_channel_identities')
        .select('id, tenant_id, customer_id, channel, external_id')
        .eq('tenant_id', tenantId)
        .eq('channel', channel)
        .eq('external_id', externalId)
        .maybeSingle();
      if (error) throw error;
      return data ? mapIdentity(data) : null;
    },

    async findCustomerByNormalizedPhone(tenantId, normalizedPhone) {
      const { data, error } = await admin
        .from('customers')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('normalized_phone', normalizedPhone)
        .is('merged_into', null)
        .maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },

    async createCustomer(input) {
      const { data, error } = await admin
        .from('customers')
        .insert({
          tenant_id: input.tenantId,
          name: input.displayName,
          customer_name: input.displayName,
          phone: input.phone,
          phone_number: input.phone,
          normalized_phone: input.normalizedPhone,
          source: input.source,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data.id;
    },

    async createIdentity(input) {
      const now = new Date().toISOString();
      const { data, error } = await admin
        .from('customer_channel_identities')
        .insert({
          tenant_id: input.tenantId,
          customer_id: input.customerId,
          channel: input.channel,
          external_id: input.externalId,
          verification_state: 'channel_verified',
          verified_at: now,
        })
        .select('id, tenant_id, customer_id, channel, external_id')
        .single();
      if (error) throw error;
      return mapIdentity(data);
    },

    async deleteUnreferencedCustomer(customerId, tenantId) {
      // A concurrent winner may have created the identity after our customer
      // insert. The FK prevents deletion if anything else has adopted this row.
      await admin.from('customers').delete().eq('id', customerId).eq('tenant_id', tenantId);
    },
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}

export async function ensureCustomerChannelIdentity(
  input: {
    tenantId: string;
    channel: CustomerChannel;
    externalId: string;
    displayName?: string | null;
  },
  store: ChannelIdentityStore = createChannelIdentityStore(),
): Promise<ChannelIdentityResolution> {
  const rawExternalId = input.externalId.trim();
  const normalizedPhone = input.channel === 'whatsapp' ? normalizePhone(rawExternalId) : null;
  if (input.channel === 'whatsapp' && !normalizedPhone) {
    throw new Error('Invalid WhatsApp customer identifier');
  }
  if (!rawExternalId) throw new Error('Missing channel customer identifier');

  // WhatsApp identifiers are canonical E.164 numbers. Instagram scoped IDs are
  // opaque strings and must never pass through phone normalization.
  const externalId = normalizedPhone ?? rawExternalId;
  const existing = await store.findIdentity(input.tenantId, input.channel, externalId);
  if (existing) {
    return { identityId: existing.id, customerId: existing.customerId, created: false };
  }

  let customerId: string | null = null;
  let createdCustomerId: string | null = null;
  if (normalizedPhone) {
    customerId = await store.findCustomerByNormalizedPhone(input.tenantId, normalizedPhone);
  }

  if (!customerId) {
    try {
      customerId = await store.createCustomer({
        tenantId: input.tenantId,
        displayName: input.displayName?.trim() || normalizedPhone || 'Instagram customer',
        phone: normalizedPhone,
        normalizedPhone,
        source: `${input.channel}_channel_identity`,
      });
      createdCustomerId = customerId;
    } catch (error) {
      // Two first messages for the same WhatsApp number can race. Reuse the
      // customer that won the tenant+phone uniqueness constraint.
      if (!isUniqueViolation(error) || !normalizedPhone) throw error;
      customerId = await store.findCustomerByNormalizedPhone(input.tenantId, normalizedPhone);
      if (!customerId) throw error;
    }
  }

  try {
    const identity = await store.createIdentity({
      tenantId: input.tenantId,
      customerId,
      channel: input.channel,
      externalId,
    });
    return { identityId: identity.id, customerId: identity.customerId, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await store.findIdentity(input.tenantId, input.channel, externalId);
    if (!winner) throw error;
    if (createdCustomerId && createdCustomerId !== winner.customerId) {
      await store.deleteUnreferencedCustomer(createdCustomerId, input.tenantId);
    }
    return { identityId: winner.id, customerId: winner.customerId, created: false };
  }
}
