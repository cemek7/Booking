import { getConversation, updateConversation } from './conversationState';
import type { ConvChannel } from './conversationState';

const HUMAN_HANDLING_UNTIL_KEY = 'human_handling_until';

export function isHumanHandling(
  flowData: Record<string, unknown> | null | undefined,
  now: number = Date.now()
): boolean {
  const until = flowData?.[HUMAN_HANDLING_UNTIL_KEY];
  return typeof until === 'string' && Date.parse(until) > now;
}

interface HumanHandlingTarget {
  externalId: string;
  tenantId: string;
  channel: ConvChannel;
}

export async function setHumanHandling(
  args: HumanHandlingTarget & { minutes: number }
): Promise<void> {
  const conv = await getConversation(args.externalId, args.tenantId, args.channel);
  if (!conv) return;

  const until = new Date(Date.now() + args.minutes * 60_000).toISOString();
  await updateConversation(
    args.externalId,
    args.tenantId,
    {
      flow_data: {
        ...(conv.flow_data ?? {}),
        [HUMAN_HANDLING_UNTIL_KEY]: until,
      },
    },
    args.channel
  );
}

export async function clearHumanHandling(args: HumanHandlingTarget): Promise<void> {
  const conv = await getConversation(args.externalId, args.tenantId, args.channel);
  if (!conv) return;

  const nextFlowData = { ...(conv.flow_data ?? {}) };
  delete nextFlowData[HUMAN_HANDLING_UNTIL_KEY];

  await updateConversation(
    args.externalId,
    args.tenantId,
    { flow_data: nextFlowData },
    args.channel
  );
}
