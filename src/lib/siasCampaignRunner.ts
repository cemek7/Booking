import { defaultLogger } from '@/lib/logger';
import { recordFrontDeskEvent } from '@/lib/ai/front-desk-events';
import { getTenantWhatsAppProviderClient } from '@/lib/whatsapp/providers/providerSelection';
import { siasOperations } from '@/lib/sias-operations';

type CampaignRow = {
  id: string;
  tenant_id: string;
  campaign_type: string;
  action: string;
  target_phone: string | null;
  target_booking_id: string | null;
  source_event: string | null;
  status: string | null;
  attempts: number | null;
  max_attempts: number | null;
  scheduled_for: string | null;
  next_retry_at: string | null;
  metadata: Record<string, unknown> | null;
  attribution: Record<string, unknown> | null;
};

export type SiasCampaignRunResult = {
  processed: number;
  delivered: number;
  failed: number;
};

export type SiasCampaignRunOptions = {
  campaignId?: string;
};

function nextRetryForAttempt(attempts: number) {
  const delayMinutes = Math.min(60, Math.max(5, 5 * Math.pow(2, Math.max(0, attempts - 1))));
  return new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
}

async function executeCampaignRow(campaign: CampaignRow, tenantId: string) {
  const message =
    typeof campaign.metadata?.message === 'string'
      ? String(campaign.metadata.message)
      : campaign.action === 'request_review'
        ? 'How was your experience with us? Reply with a quick rating or leave a review.'
        : campaign.action === 'offer_upsell'
          ? 'We have a special offer for your next visit. Reply YES and we will share details.'
          : campaign.action === 'send_reactivation'
            ? 'We have missed you. Reply BOOK to rebook your next visit.'
            : 'Reminder: you have an upcoming booking.';

  if (campaign.action === 'tag_customer_memory') {
    await siasOperations.updateOperationalMemory({
      tenantId,
      memoryKey: String(campaign.metadata?.memoryKey ?? 'campaign_memory'),
      memoryValue: {
        ...(campaign.metadata?.memoryValue ?? {}),
        campaign_id: campaign.id,
        action: campaign.action,
      },
      source: String(campaign.source_event ?? 'campaign.run'),
      confidence: 0.75,
    });
    return { delivered: true, skipped: true };
  }

  if (campaign.action === 'escalate_to_human') {
    await siasOperations.createEscalationTicket({
      tenantId,
      customerPhone: String(campaign.target_phone ?? 'unknown'),
      sessionId: String(campaign.target_booking_id ?? campaign.id),
      reason: String(campaign.metadata?.reason ?? 'campaign escalation'),
      conversationSnapshot: Array.isArray(campaign.metadata?.conversationSnapshot)
        ? campaign.metadata.conversationSnapshot
        : [],
    });
    return { delivered: true, escalated: true };
  }

  if (!campaign.target_phone) {
    throw new Error('Campaign target phone is required for outbound messaging');
  }

  const client = await getTenantWhatsAppProviderClient(tenantId);
  if (!client) {
    throw new Error('No WhatsApp provider configured');
  }

  const result = await client.sendTextMessage(String(campaign.target_phone), message);
  if (!result.success) {
    throw new Error('Campaign message send failed');
  }

  const signal =
    campaign.action === 'send_reminder'
      ? 'no_show_reduction'
      : campaign.action === 'send_reactivation'
        ? 'revenue_recovery'
        : campaign.action === 'request_review'
          ? 'repeat_booking_lift'
          : 'revenue_recovery';

  await siasOperations.recordOutcomeAttribution({
    tenantId,
    signal,
    sourceEvent: String(campaign.source_event ?? 'campaign.run'),
    reservationId: campaign.target_booking_id ?? null,
    customerPhone: campaign.target_phone ?? null,
    attributedTo: campaign.action,
    value: 1,
    campaignRunId: campaign.id,
    metadata: {
      campaign_type: campaign.campaign_type,
      action: campaign.action,
    },
  });

  await recordFrontDeskEvent({
    tenantId,
    eventType: campaign.action === 'send_reactivation' ? 'recovery_sent' : 'follow_up_sent',
    eventCategory: campaign.action === 'send_reactivation' ? 'retention' : 'sales',
    channel: 'whatsapp',
    actorRole: 'system',
    campaignRunId: campaign.id,
    correlationId: campaign.id,
    metadata: {
      action: campaign.action,
      campaign_type: campaign.campaign_type,
      target_phone: campaign.target_phone,
      source_event: campaign.source_event,
    },
  });

  return { delivered: true, skipped: false };
}

export async function runDueSiasCampaigns(
  supabase: any,
  tenantId: string,
  limit = 25,
  options: SiasCampaignRunOptions = {}
): Promise<SiasCampaignRunResult> {
  const now = new Date().toISOString();
  let dueCampaigns: CampaignRow[] = [];

  if (options.campaignId) {
    const { data, error } = await supabase
      .from('sias_campaign_runs')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', options.campaignId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data) {
      dueCampaigns = [data as CampaignRow];
    }
  } else {
    const { data, error } = await supabase
      .from('sias_campaign_runs')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('status', ['pending', 'retry_scheduled'])
      .lte('scheduled_for', now)
      .order('scheduled_for', { ascending: true })
      .limit(limit);

    if (error) {
      throw error;
    }

    dueCampaigns = (data ?? []) as CampaignRow[];
  }

  let processed = 0;
  let delivered = 0;
  let failed = 0;

  for (const row of (dueCampaigns ?? []) as CampaignRow[]) {
    const { data: claimed } = await supabase
      .from('sias_campaign_runs')
      .update({ status: 'processing', updated_at: now })
      .eq('id', row.id)
      .eq('tenant_id', tenantId)
      .select('*')
      .maybeSingle();

    if (!claimed) continue;

    processed++;

    try {
      const result = await executeCampaignRow(claimed as CampaignRow, tenantId);
      await siasOperations.updateCampaignRun(claimed.id, {
        status: result.skipped ? 'completed' : 'sent',
        attempts: Number(claimed.attempts ?? 0) + 1,
        sentAt: new Date(),
        completedAt: new Date(),
        error: null,
      });
      delivered++;
    } catch (err) {
      const attempts = Number(claimed.attempts ?? 0) + 1;
      const maxAttempts = Number(claimed.max_attempts ?? 5);
      const retryable = attempts < maxAttempts;
      const nextRetryAt = retryable ? nextRetryForAttempt(attempts) : null;

      await siasOperations.updateCampaignRun(claimed.id, {
        status: retryable ? 'retry_scheduled' : 'failed',
        attempts,
        nextRetryAt,
        error: err instanceof Error ? err.message : String(err),
      });

      if (!retryable) {
        defaultLogger.warn('[SIAS] Campaign exhausted retries', {
          campaignId: claimed.id,
          tenantId,
        });
      }

      failed++;
    }
  }

  return { processed, delivered, failed };
}
