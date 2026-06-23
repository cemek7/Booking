import type { SupabaseClient } from '@supabase/supabase-js';
import { CFG } from './config';
import { decideSend } from './metaSendGate';
import { loadNumberQuality } from './numberQuality';
import { evaluateSend, recordSend } from './sendGovernor';
import { resolveTemplate } from './templateRegistry';

export interface GovernedSendParams {
  tenantId: string;
  recipient: string;
  messageType: string;
  lastInboundAt: string | null;
  optedOutAt: string | null;
  language?: string;
  buildFreeform: () => string;
  sendFreeform: (text: string) => Promise<boolean>;
  sendTemplate: (name: string, language: string, paramMapping: unknown[]) => Promise<boolean>;
}

export interface GovernedSendResult {
  sent: boolean;
  mode?: 'freeform' | 'template';
  reason: string;
}

export async function sendGovernedInitiated(
  admin: SupabaseClient,
  params: GovernedSendParams,
): Promise<GovernedSendResult> {
  const now = Date.now();
  const numberQuality = await loadNumberQuality(admin, params.tenantId);
  const inWindow = params.lastInboundAt
    ? now - Date.parse(params.lastInboundAt) < CFG.windowMs()
    : false;

  if (numberQuality.quality === 'RED' && !inWindow) {
    return { sent: false, reason: 'red_quality_cold_hold' };
  }

  const governorDecision = await evaluateSend(admin, params.tenantId, numberQuality, params.recipient);
  if (!governorDecision.allow) {
    return { sent: false, reason: governorDecision.reason };
  }

  const template = await resolveTemplate(
    admin,
    params.tenantId,
    params.messageType,
    params.language ?? 'en_US',
  );

  const gateDecision = decideSend({
    initiated: true,
    lastInboundAt: params.lastInboundAt,
    optedOutAt: params.optedOutAt,
    messageType: params.messageType,
    template: template ? { name: template.name, language: template.language } : null,
  });

  if (gateDecision.mode === 'hold') {
    return { sent: false, reason: gateDecision.reason };
  }

  const cold = !inWindow;
  const ok =
    gateDecision.mode === 'template'
      ? await params.sendTemplate(template!.name, template!.language, template!.paramMapping)
      : await params.sendFreeform(params.buildFreeform());

  await recordSend(admin, params.tenantId, {
    recipient: params.recipient,
    initiated: true,
    cold,
    failed: !ok,
  });

  return {
    sent: ok,
    mode: gateDecision.mode === 'template' ? 'template' : 'freeform',
    reason: ok ? 'sent' : 'send_failed',
  };
}
