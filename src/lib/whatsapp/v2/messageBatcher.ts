/**
 * @deprecated Queue rows plus claim_whatsapp_conversation_batch are canonical.
 * This shim intentionally fails so JSON pending_messages cannot re-enter a
 * production path during the expand/contract rollout.
 */

function retired(): never {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[messageBatcher] legacy JSON batching is retired; use queueBatch');
  }
  throw new Error('Legacy JSON message batching is disabled');
}

export async function appendPendingMessage(): Promise<void> {
  retired();
}

export async function claimBatch(): Promise<never> {
  return retired();
}
