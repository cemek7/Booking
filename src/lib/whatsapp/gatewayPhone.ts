/**
 * The E.164 number customers message to reach Booka's shared gateway.
 *
 * This used to be read inline as `process.env.EVOLUTION_DEFAULT_PHONE` in three
 * places, each handling absence differently — and the onboarding flow invented
 * a placeholder number when it was missing. The name is also a leftover from
 * the Evolution API era; the gateway is Meta now.
 *
 * `BOOKA_GATEWAY_PHONE` is the only name. The Evolution-era alias was dropped
 * outright rather than deprecated: there are no tenants yet, so a clean break
 * costs nothing, and a fallback nobody needs is just a second place for the
 * number to be wrong.
 *
 * Distinct from META_SHARED_GATEWAY_PHONE_NUMBER_ID: that is Meta's opaque
 * phone_number_id used for API calls, this is the dialable number a wa.me link
 * needs. They are not interchangeable.
 */
export function getBookaGatewayPhone(): string | null {
  const raw = process.env.BOOKA_GATEWAY_PHONE || '';
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
}

/** A wa.me deep link that opens a chat with the gateway, pre-filled. */
export function buildGatewayChatLink(text: string): string | null {
  const phone = getBookaGatewayPhone();
  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
