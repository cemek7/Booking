import type { SupabaseClient } from '@supabase/supabase-js';

interface DuplicateLookupFields {
  amountCents?: number | null;
  date?: string | null;
  supplier?: string | null;
  reference?: string | null;
}

interface MediaInputRow {
  id: string;
}

interface ExtractedRecordRow {
  id: string;
  fields?: Record<string, unknown> | null;
  linked_record_id?: string | null;
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

export async function findDuplicate(
  admin: SupabaseClient,
  tenantId: string,
  hash: string,
  fields: DuplicateLookupFields,
): Promise<string | null> {
  const { data: hashMatch, error: hashError } = await admin
    .from('media_inputs')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('file_hash', hash)
    .maybeSingle<MediaInputRow>();

  if (hashError) throw hashError;
  if (hashMatch?.id) return hashMatch.id;

  const normalizedAmount = Number(fields.amountCents ?? 0);
  const normalizedDateValue = normalizeDate(fields.date);
  const normalizedSupplier = normalizeText(fields.supplier);
  const normalizedReference = normalizeText(fields.reference);

  if (!normalizedAmount || !normalizedDateValue || !normalizedSupplier) {
    return null;
  }

  const { data: records, error: recordError } = await admin
    .from('extracted_records')
    .select('id, fields, linked_record_id')
    .eq('tenant_id', tenantId)
    .in('record_type', ['expense', 'purchase', 'stock_receipt', 'supplier_payment']);

  if (recordError) throw recordError;

  for (const record of (records ?? []) as ExtractedRecordRow[]) {
    const payload = record.fields ?? {};
    const amount = Number(
      payload.amount_cents
      ?? payload.total_cents
      ?? payload.amount
      ?? 0,
    );
    const dateValue = normalizeDate(
      typeof payload.expense_date === 'string'
        ? payload.expense_date
        : typeof payload.purchase_date === 'string'
          ? payload.purchase_date
          : typeof payload.payment_date === 'string'
            ? payload.payment_date
            : typeof payload.date === 'string'
              ? payload.date
              : null,
    );
    const supplier = normalizeText(
      typeof payload.supplier === 'string'
        ? payload.supplier
        : typeof payload.supplier_name === 'string'
          ? payload.supplier_name
          : null,
    );
    const reference = normalizeText(
      typeof payload.reference === 'string' ? payload.reference : null,
    );

    if (amount !== normalizedAmount) continue;
    if (dateValue !== normalizedDateValue) continue;
    if (supplier !== normalizedSupplier) continue;
    if (normalizedReference && reference && reference !== normalizedReference) continue;

    return record.linked_record_id ?? record.id;
  }

  return null;
}
