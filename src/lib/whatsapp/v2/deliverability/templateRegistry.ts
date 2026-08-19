import type { SupabaseClient } from '@supabase/supabase-js';

export interface ResolvedTemplate {
  name: string;
  language: string;
  paramMapping: unknown[];
}

async function fetchOne(
  admin: SupabaseClient,
  tenantId: string | null,
  messageType: string,
  language: string,
): Promise<ResolvedTemplate | null> {
  let query = admin
    .from('message_templates')
    .select('template_name, language, param_mapping, status')
    .eq('message_type', messageType)
    .eq('language', language);

  query = tenantId === null ? query.is('tenant_id', null) : query.eq('tenant_id', tenantId);

  const { data } = await query.maybeSingle();
  if (!data || data.status !== 'approved') return null;

  return {
    name: data.template_name as string,
    language: data.language as string,
    paramMapping: (data.param_mapping ?? []) as unknown[],
  };
}

export async function resolveTemplate(
  admin: SupabaseClient,
  tenantId: string,
  messageType: string,
  language = 'en_US',
): Promise<ResolvedTemplate | null> {
  return (
    (await fetchOne(admin, tenantId, messageType, language)) ??
    (await fetchOne(admin, null, messageType, language))
  );
}
