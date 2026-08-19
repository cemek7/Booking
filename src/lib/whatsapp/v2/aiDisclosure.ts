/**
 * AI-interaction disclosure (GDPR/transparency + Meta policy).
 *
 * Sent once per customer conversation, on first contact. The "already sent"
 * flag lives in the conversation's persistent `flow_data` JSONB so it survives
 * across sessions without a schema change.
 */

const FLAG = 'ai_disclosure_sent_at';

export interface DisclosureResult {
  text: string;
  flowDataPatch: Record<string, unknown>;
}

/**
 * Returns the disclosure message + a `flow_data` patch to persist when this
 * conversation has not yet been told it is talking to an automated assistant.
 * Returns null if the disclosure was already sent.
 */
export function ensureDisclosure(
  flowData: Record<string, unknown> | null | undefined,
  opts?: { businessName?: string },
): DisclosureResult | null {
  if (flowData && flowData[FLAG]) return null;

  const who = opts?.businessName ? ` for ${opts.businessName}` : '';
  const text =
    `👋 Heads up: you're chatting with an automated assistant${who}. ` +
    `I can help you book and answer questions. Reply "agent" anytime to reach a person.`;

  return { text, flowDataPatch: { [FLAG]: new Date().toISOString() } };
}

/**
 * Orchestrates the first-contact disclosure: if not yet sent, sends it via the
 * injected `send` then persists the flag via `persist`. Send happens before
 * persist so a failed send leaves the flag unset (the disclosure retries next
 * message rather than being silently skipped). Returns whether it was sent.
 */
export async function sendDisclosureIfNeeded(args: {
  flowData: Record<string, unknown> | null | undefined;
  businessName?: string;
  send: (text: string) => Promise<void>;
  persist: (patch: Record<string, unknown>) => Promise<void>;
}): Promise<boolean> {
  const result = ensureDisclosure(args.flowData, { businessName: args.businessName });
  if (!result) return false;
  await args.send(result.text);
  await args.persist(result.flowDataPatch);
  return true;
}
