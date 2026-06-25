import type { SupabaseClient } from '@supabase/supabase-js';

/** Review moderation: reports (review_flags) + takedown (reviews.hidden). Migration 110. */

export type FlagStatus = 'pending' | 'resolved' | 'dismissed';

export async function flagReview(
  admin: SupabaseClient,
  p: { tenantId: string; reviewId: string; reason: string; reporter?: string | null },
): Promise<void> {
  await admin.from('review_flags').insert({
    tenant_id: p.tenantId,
    review_id: p.reviewId,
    reason: p.reason,
    reporter: p.reporter ?? null,
    status: 'pending',
  });
}

export async function setReviewHidden(
  admin: SupabaseClient,
  p: { tenantId: string; reviewId: string; hidden: boolean },
): Promise<void> {
  await admin
    .from('reviews')
    .update({ hidden: p.hidden })
    .eq('id', p.reviewId)
    .eq('tenant_id', p.tenantId);
}

export async function listReviewFlags(
  admin: SupabaseClient,
  p: { tenantId: string; status?: FlagStatus },
): Promise<unknown[]> {
  let q = admin.from('review_flags').select('*').eq('tenant_id', p.tenantId);
  if (p.status) q = q.eq('status', p.status);
  const { data } = await q.order('created_at', { ascending: false });
  return (data as unknown[]) ?? [];
}

export async function resolveFlag(
  admin: SupabaseClient,
  p: { tenantId: string; flagId: string; status: FlagStatus },
): Promise<void> {
  await admin
    .from('review_flags')
    .update({ status: p.status })
    .eq('id', p.flagId)
    .eq('tenant_id', p.tenantId);
}
