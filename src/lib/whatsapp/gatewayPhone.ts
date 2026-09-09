/**
 * The E.164 number customers message to reach Booka's shared gateway.
 *
 * This used to be read inline as `process.env.EVOLUTION_DEFAULT_PHONE` in three
 * places, each handling absence differently — and the onboarding flow invented
 * a placeholder number when it was missing. The name is also a leftover from
 * the Evolution API era; the gateway is Meta now.
 *
 * `BOOKA_GATEWAY_PHONE` is the name going forward. `EVOLUTION_DEFAULT_PHONE` is
 * still read so an existing deployment keeps working, and is deprecated.
 *
 * Distinct from META_SHARED_GATEWAY_PHONE_NUMBER_ID: that is Meta's opaque
 * phone_number_id used for API calls, this is the dialable number a wa.me link
 * needs. They are not interchangeable.
 */
export function getBookaGatewayPhone(): string | null {
  const raw = process.env.BOOKA_GATEWAY_PHONE
    // Deprecated: kept so a deployment set up before the rename still works.
    || process.env.EVOLUTION_DEFAULT_PHONE
    || '';
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
}

/** A wa.me deep link that opens a chat with the gateway, pre-filled. */
export function buildGatewayChatLink(text: string): string | null {
  const phone = getBookaGatewayPhone();
  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
