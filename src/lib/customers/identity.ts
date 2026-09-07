import type { SupabaseClient } from '@supabase/supabase-js';

export interface ResolveCustomerInput {
  name?: string | null;
  email?: string | null;
  source?: string | null;
}

type CustomerIdentityRow = {
  id: string;
  name?: string | null;
  customer_name?: string | null;
  email?: string | null;
  last_visit?: string | null;
  total_bookings?: number | null;
  merged_into?: string | null;
};

function onlyDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const digits = onlyDigits(raw.trim());
  if (!digits) return null;

  if (digits.startsWith('234') && digits.length === 13) {
    return `+${digits}`;
  }

  if (digits.startsWith('0') && digits.length === 11) {
    return `+234${digits.slice(1)}`;
  }

  if (digits.length === 10) {
    return `+234${digits}`;
  }

  if (!digits.startsWith('0') && !digits.startsWith('234') && digits.length >= 8) {
    return `+${digits}`;
  }

  return null;
}

async function lookupByField(
  admin: SupabaseClient,
  tenantId: string,
  field: 'normalized_phone' | 'phone' | 'phone_number',
  value: string,
  select = 'id, merged_into',
): Promise<CustomerIdentityRow | null> {
  const { data, error } = await admin
    .from('customers')
    .select(select)
    .eq('tenant_id', tenantId)
    .eq(field, value)
    .is('merged_into', null)
    .maybeSingle<CustomerIdentityRow>();

  if (error) throw error;
  return data ?? null;
}

export async function findCustomerByPhone(
  admin: SupabaseClient,
  tenantId: string,
  phone: string | null | undefined,
  select = 'id, name, customer_name, email, last_visit, total_bookings, merged_into',
): Promise<CustomerIdentityRow | null> {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;

  return (
    (await lookupByField(admin, tenantId, 'normalized_phone', normalizedPhone, select)) ??
    (await lookupByField(admin, tenantId, 'phone', normalizedPhone, select)) ??
    (await lookupByField(admin, tenantId, 'phone_number', normalizedPhone, select))
  );
}

export async function resolveCustomer(
  admin: SupabaseClient,
  tenantId: string,
  phone: string | null | undefined,
  input: ResolveCustomerInput = {},
): Promise<string | null> {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;

  const existing = await findCustomerByPhone(admin, tenantId, normalizedPhone, 'id, merged_into');

  if (existing?.id) return existing.id;

  const displayName = input.name?.trim() || normalizedPhone;
  const { data, error } = await admin
    .from('customers')
    .insert({
      tenant_id: tenantId,
      name: displayName,
      customer_name: displayName,
      email: input.email?.trim() || null,
      phone: normalizedPhone,
      phone_number: normalizedPhone,
      normalized_phone: normalizedPhone,
      source: input.source?.trim() || 'customer_identity',
    })
    .select('id')
    .maybeSingle<{ id: string }>();

  if (error) throw error;
  return typeof data?.id === 'string' ? data.id : null;
}
