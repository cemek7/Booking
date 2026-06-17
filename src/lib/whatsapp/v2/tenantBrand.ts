/**
 * Tenant brand maintenance: emoji defaults + rename bookkeeping.
 *
 * `renameTenantBrand` is the single writer of the customer-facing brand fields
 * (display_name / previous_names / renamed_at). Routing a rename through here —
 * rather than a plain tenants UPDATE — is what preserves the "formerly known as"
 * drift line that the brand-identity layer shows to customers.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Maps a business vertical to a default brand emoji, or null when unknown. */
export function suggestEmojiForVertical(vertical: string | null | undefined): string | null {
  switch ((vertical ?? '').toLowerCase()) {
    case 'barber':
    case 'barbershop':
      return '✂️';
    case 'salon':
    case 'hair':
      return '💇';
    case 'spa':
      return '💆';
    case 'dental':
    case 'dentist':
      return '🦷';
    default:
      return null;
  }
}

/**
 * Records a customer-facing rename: archives the current name into
 * previous_names with a timestamp and sets the new display_name + renamed_at.
 */
export async function renameTenantBrand(tenantId: string, newDisplayName: string): Promise<void> {
  const { data: t } = await supabaseAdmin
    .from('tenants')
    .select('name, display_name, previous_names')
    .eq('id', tenantId)
    .maybeSingle();

  if (!t) throw new Error(`renameTenantBrand: tenant ${tenantId} not found`);

  const currentName = (t.display_name as string | null) ?? (t.name as string);
  const prev = Array.isArray(t.previous_names) ? t.previous_names : [];
  const now = new Date().toISOString();

  await supabaseAdmin
    .from('tenants')
    .update({
      display_name: newDisplayName,
      previous_names: [...prev, { name: currentName, renamed_at: now }],
      renamed_at: now,
    })
    .eq('id', tenantId);
}
