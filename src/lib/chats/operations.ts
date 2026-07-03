export const CHAT_SUPPORT_STATUSES = ['open', 'pending', 'resolved'] as const;

export type ChatSupportStatus = (typeof CHAT_SUPPORT_STATUSES)[number];

export type ChatChannel = 'whatsapp' | 'instagram';

export type ChatSupportState = {
  status: ChatSupportStatus;
  assigneeUserId: string | null;
  assigneeLabel: string | null;
};

export type ChatMetadata = {
  subject?: string;
  channel?: ChatChannel;
  support?: Partial<ChatSupportState> | null;
} | null;

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
