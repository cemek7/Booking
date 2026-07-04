export const CHAT_SUPPORT_STATUSES = ['open', 'pending', 'resolved'] as const;

export type ChatSupportStatus = (typeof CHAT_SUPPORT_STATUSES)[number];

export type ChatChannel = 'whatsapp' | 'instagram';

export const CHAT_JOURNEY_TYPES = ['general', 'lead', 'booking', 'retail', 'support', 'mixed'] as const;

export type ChatJourneyType = (typeof CHAT_JOURNEY_TYPES)[number];

export type ChatJourneyState = {
  type: ChatJourneyType;
  stage: string | null;
  leadId: string | null;
  cartId: string | null;
  orderId: string | null;
  cartItemCount: number;
  orderTotalCents: number | null;
  updatedAt: string | null;
};

export type ChatSupportState = {
  status: ChatSupportStatus;
  assigneeUserId: string | null;
  assigneeLabel: string | null;
};

export type ChatMetadata = {
  subject?: string;
  channel?: ChatChannel;
  support?: Partial<ChatSupportState> | null;
  journey?: Partial<ChatJourneyState> | null;
} | null;

export const DEFAULT_CHAT_JOURNEY_STATE: ChatJourneyState = {
  type: 'general',
  stage: null,
  leadId: null,
  cartId: null,
  orderId: null,
  cartItemCount: 0,
  orderTotalCents: null,
  updatedAt: null,
};

export const DEFAULT_CHAT_SUPPORT_STATE: ChatSupportState = {
  status: 'open',
  assigneeUserId: null,
  assigneeLabel: null,
};

export function getChatSupportState(metadata: ChatMetadata): ChatSupportState {
  const support = metadata?.support ?? null;
  const status = support?.status;

  return {
    status:
      status && CHAT_SUPPORT_STATUSES.includes(status)
        ? status
        : DEFAULT_CHAT_SUPPORT_STATE.status,
    assigneeUserId:
      typeof support?.assigneeUserId === 'string' ? support.assigneeUserId : null,
    assigneeLabel:
      typeof support?.assigneeLabel === 'string' ? support.assigneeLabel : null,
  };
}

export function getChatJourneyState(metadata: ChatMetadata): ChatJourneyState {
  const journey = metadata?.journey ?? null;
  const type = journey?.type;

  return {
    type:
      type && CHAT_JOURNEY_TYPES.includes(type)
        ? type
        : DEFAULT_CHAT_JOURNEY_STATE.type,
    stage: typeof journey?.stage === 'string' && journey.stage.trim().length > 0
      ? journey.stage.trim()
      : null,
    leadId: typeof journey?.leadId === 'string' ? journey.leadId : null,
    cartId: typeof journey?.cartId === 'string' ? journey.cartId : null,
    orderId: typeof journey?.orderId === 'string' ? journey.orderId : null,
    cartItemCount:
      typeof journey?.cartItemCount === 'number' && Number.isFinite(journey.cartItemCount)
        ? Math.max(0, Math.trunc(journey.cartItemCount))
        : DEFAULT_CHAT_JOURNEY_STATE.cartItemCount,
    orderTotalCents:
      typeof journey?.orderTotalCents === 'number' && Number.isFinite(journey.orderTotalCents)
        ? Math.max(0, Math.trunc(journey.orderTotalCents))
        : null,
    updatedAt: typeof journey?.updatedAt === 'string' ? journey.updatedAt : null,
  };
}

export function mergeChatSupportState(
  metadata: ChatMetadata,
  patch: Partial<ChatSupportState>
): NonNullable<ChatMetadata> {
  const nextSupport = {
    ...getChatSupportState(metadata),
    ...patch,
  };

  return {
    ...(metadata ?? {}),
    support: nextSupport,
  };
}

export function mergeChatJourneyState(
  metadata: ChatMetadata,
  patch: Partial<ChatJourneyState>
): NonNullable<ChatMetadata> {
  const nextJourney = {
    ...getChatJourneyState(metadata),
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };

  return {
    ...(metadata ?? {}),
    journey: nextJourney,
  };
}
