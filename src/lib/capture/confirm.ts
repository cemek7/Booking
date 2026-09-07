import type { SupabaseClient } from '@supabase/supabase-js';
import { executeAction, validateAction, type AIResponse } from '@/lib/booking/action-validator';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';

type ExtractionRecordRow = {
  id: string;
  tenant_id: string;
  job_id: string;
  record_type: string;
  fields?: Record<string, unknown> | null;
  proposed_action?: AIResponse | null;
  linked_record_type?: string | null;
  linked_record_id?: string | null;
};

function extractLinkedRecord(data: unknown): { type: string; id: string } | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;

  for (const [key, value] of Object.entries(record)) {
    if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
      return { type: key, id: (value as { id: string }).id };
    }
  }

  return null;
}

export async function confirmExtraction(
  admin: SupabaseClient,
  recordId: string,
  actorId: string,
  permissions: string[] = [],
): Promise<{ linkedRecordType: string; linkedRecordId: string }> {
  const { data: record, error } = await admin
    .from('extracted_records')
    .select('id, tenant_id, job_id, record_type, fields, proposed_action, linked_record_type, linked_record_id')
    .eq('id', recordId)
    .single<ExtractionRecordRow>();

  if (error || !record) {
    throw error ?? new Error('Extracted record not found');
  }

  if (record.linked_record_type && record.linked_record_id) {
    return {
      linkedRecordType: record.linked_record_type,
      linkedRecordId: record.linked_record_id,
    };
  }

  if (record.fields && typeof record.fields.duplicate_match_id === 'string') {
    throw new Error('Duplicate capture must be reviewed manually before confirmation');
  }

  if (!record.proposed_action) {
    throw new Error('Extracted record has no proposed action to confirm');
  }

  const validation = await validateAction(record.tenant_id, record.proposed_action);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Proposed action failed validation');
  }

  const execution = await executeAction(record.tenant_id, record.proposed_action, {
    actorId,
    permissions,
    channel: 'dashboard',
    userRole: 'owner',
  });

  if (!execution.success) {
    throw new Error(execution.error ?? 'Failed to execute proposed action');
  }

  const linked = extractLinkedRecord(execution.data);
  if (!linked) {
    throw new Error('Executed action did not return a linked record');
  }

  const { error: extractedUpdateError } = await admin
    .from('extracted_records')
    .update({
      linked_record_type: linked.type,
      linked_record_id: linked.id,
    })
    .eq('id', record.id);

  if (extractedUpdateError) throw extractedUpdateError;

  const { error: jobUpdateError } = await admin
    .from('extraction_jobs')
    .update({
      status: 'confirmed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', record.job_id);

  if (jobUpdateError) throw jobUpdateError;

  await recordBusinessEvent(admin, {
    tenantId: record.tenant_id,
    actorType: 'user',
    actorId,
    action: BUSINESS_EVENT_ACTIONS.CAPTURE_CONFIRMED,
    entityType: 'extracted_record',
    entityId: record.id,
    source: 'dashboard',
    metadata: {
      linked_record_type: linked.type,
      linked_record_id: linked.id,
      capture_record_type: record.record_type,
    },
  });

  return {
    linkedRecordType: linked.type,
    linkedRecordId: linked.id,
  };
}
