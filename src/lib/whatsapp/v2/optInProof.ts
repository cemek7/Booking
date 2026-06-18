/**
 * Meta/WhatsApp opt-in proof.
 *
 * When a customer messages a tenant first, that user-initiated contact is the
 * lawful basis for replying within the service window. We record that fact once
 * per conversation in `flow_data.opt_in` (no schema change).
 *
 * NOTE: this records IMPLIED, customer-initiated opt-in only. Explicit opt-in
 * for business-initiated marketing/template messages (reminders, rebooking
 * nudges) should additionally be captured via a consent checkbox on the booking
 * mini-site — that is a separate UX change, flagged for the owner.
 */

const KEY = 'opt_in';

export interface OptInProof {
  at: string;
  source: 'customer_initiated';
  basis: 'user_initiated_contact';
  channel: string;
}

/**
 * Returns a `flow_data` patch recording opt-in proof if not already recorded;
 * otherwise null.
 */
export function buildOptInProofPatch(
  flowData: Record<string, unknown> | null | undefined,
  channel: string,
): { [KEY]: OptInProof } | null {
  if (flowData && flowData[KEY]) return null;
  return {
    [KEY]: {
      at: new Date().toISOString(),
      source: 'customer_initiated',
      basis: 'user_initiated_contact',
      channel,
    },
  };
}
