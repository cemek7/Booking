import type { NextApiRequest } from 'next';
import crypto from 'crypto';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { JobPayload } from '@/types/jobs';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function readRawBody(req: NextApiRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err: Error) => reject(err));
  });
}

export function verifyHmac(rawBody: string | Buffer, secret: string | undefined, signatureHeader: string | undefined) {
  if (!secret || !signatureHeader) return false;
  const sig = signatureHeader.includes('=') ? signatureHeader.split('=')[1] : signatureHeader;
  const hmac = crypto.createHmac('sha256', secret);
  // Buffer or string are acceptable to update
  hmac.update(rawBody as Buffer | string);
  const digest = hmac.digest('hex');
  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function normalizePayload(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null) return raw as Record<string, unknown>;
  return { body: String(raw ?? '') };
}

export async function enqueueJob(supabase: SupabaseClient, type: string, payload: JobPayload | null, scheduledAt?: string | null) {
  const row = {
    type,
    payload: payload ?? null,
    attempts: 0,
    status: 'pending',
    scheduled_at: scheduledAt || new Date().toISOString(),
    last_error: null,
  } as Record<string, unknown>;

  const res = await supabase.from('jobs').insert([row]).select();
  return res;
}
