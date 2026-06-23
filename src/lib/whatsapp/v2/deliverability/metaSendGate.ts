import { CFG } from './config';

export type SendMode = 'freeform' | 'template' | 'hold';

export interface GateTemplate {
  name: string;
  language: string;
}

export interface GateInput {
  initiated: boolean;
  lastInboundAt: string | null;
  optedOutAt: string | null;
  messageType: string;
  template?: GateTemplate | null;
  now?: number;
}

export interface GateDecision {
  mode: SendMode;
  templateName?: string;
  language?: string;
  reason: string;
}

function withinWindow(lastInboundAt: string | null, now: number): boolean {
  if (!lastInboundAt) return false;
  return now - Date.parse(lastInboundAt) < CFG.windowMs();
}

export function decideSend(input: GateInput): GateDecision {
  const now = input.now ?? Date.now();

  if (input.initiated && input.optedOutAt) {
    return { mode: 'hold', reason: 'opted_out' };
  }

  if (!input.initiated) {
    return { mode: 'freeform', reason: 'reply' };
  }

  if (withinWindow(input.lastInboundAt, now)) {
    return { mode: 'freeform', reason: 'in_window' };
  }

  if (input.template) {
    return {
      mode: 'template',
      templateName: input.template.name,
      language: input.template.language,
      reason: 'template_out_of_window',
    };
  }

  return { mode: 'hold', reason: 'no_template_outside_window' };
}
