import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type MediaInputKind =
  | 'receipt'
  | 'invoice'
  | 'voice'
  | 'photo'
  | 'pdf'
  | 'stock_sheet'
  | 'screenshot'
  | 'service_note';

export interface IngestMediaInput {
  kind: MediaInputKind;
  buffer: Buffer;
  mime: string;
  uploadedBy?: string | null;
  source?: 'whatsapp' | 'dashboard' | 'api';
  fileName?: string | null;
  metadata?: Record<string, unknown>;
}

export interface IngestMediaResult {
  mediaInputId: string;
  extractionJobId: string;
  hash: string;
  storagePath: string;
}

function buildFileExtension(mime: string, fileName?: string | null): string {
  const fromName = fileName?.includes('.') ? fileName.split('.').pop() : null;
  if (fromName) return fromName.toLowerCase();

  const fallback = mime.split('/')[1]?.toLowerCase();
  return fallback && fallback.length > 0 ? fallback : 'bin';
}

export function computeFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function ingestMedia(
  admin: SupabaseClient,
  tenantId: string,
  input: IngestMediaInput,
): Promise<IngestMediaResult> {
  const hash = computeFileHash(input.buffer);
  const extension = buildFileExtension(input.mime, input.fileName);
  const storagePath = `${tenantId}/capture/${Date.now()}_${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await admin.storage
    .from('whatsapp-media')
    .upload(storagePath, input.buffer, {
      contentType: input.mime || 'application/octet-stream',
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

  const { data: mediaInput, error: mediaError } = await admin
    .from('media_inputs')
    .insert({
      tenant_id: tenantId,
      source: input.source ?? 'dashboard',
      kind: input.kind,
      storage_path: storagePath,
      file_hash: hash,
      mime: input.mime,
      size: input.buffer.byteLength,
      uploaded_by: input.uploadedBy ?? null,
      metadata: input.metadata ?? {},
    })
    .select('id')
    .single<{ id: string }>();

  if (mediaError || !mediaInput?.id) {
    throw mediaError ?? new Error('Failed to create media input');
  }

  const { data: extractionJob, error: jobError } = await admin
    .from('extraction_jobs')
    .insert({
      tenant_id: tenantId,
      media_input_id: mediaInput.id,
      status: 'pending',
    })
    .select('id')
    .single<{ id: string }>();

  if (jobError || !extractionJob?.id) {
    throw jobError ?? new Error('Failed to create extraction job');
  }

  return {
    mediaInputId: mediaInput.id,
    extractionJobId: extractionJob.id,
    hash,
    storagePath,
  };
}
