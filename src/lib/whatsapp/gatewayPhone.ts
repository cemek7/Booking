/**
 * The number customers message to reach Booka's shared gateway.
 *
 * This used to be read inline as `process.env.EVOLUTION_DEFAULT_PHONE` in three
 * places, each handling absence differently, and the onboarding flow invented a
 * placeholder when it was missing. The name was also a leftover from the
 * Evolution API era; the gateway is Meta now.
 *
 * Distinct from META_SHARED_GATEWAY_PHONE_NUMBER_ID: that is Meta's opaque
 * phone_number_id used for API calls, this is the dialable number a wa.me link
 * needs. They are not interchangeable.
 */

/** Booka's home market. Used to expand a local number to international form. */
const DEFAULT_COUNTRY_CODE = (process.env.BOOKA_DEFAULT_COUNTRY_CODE || '234').replace(/\D/g, '');

/**
 * Normalises whatever form the number was configured in to the digits a wa.me
 * link needs: full international, no plus, no leading zero.
 *
 * This exists because the natural thing to paste is the number as it is written
 * locally — 08134052165 — and wa.me silently does nothing useful with it. There
 * is no error, no bounce; the link just fails to open a chat, on the QR code the
 * owner has already printed. Accepting the local form and expanding it is the
 * difference between a working link and a dead one nobody notices.
 *
 *   08134052165     -> 2348134052165   (leading 0 is the national trunk prefix)
 *   +234 813 405 2165 -> 2348134052165
 *   2348134052165   -> 2348134052165   (already international)
 */
export function normaliseGatewayPhone(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;

  // A leading 0 is a national trunk prefix, never part of an international
  // number, so it is replaced by the country code rather than kept.
  const international = digits.startsWith('0')
    ? `${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`
    : digits;

  // E.164 allows up to 15 digits; anything under 10 cannot carry a country code
  // plus a subscriber number, so it is a typo rather than a number.
  if (international.length < 10 || international.length > 15) {
    console.warn('[gatewayPhone] configured number does not look like an international number', {
      digits: international.length,
    });
    return null;
  }

  return international;
}

export function getBookaGatewayPhone(): string | null {
  return normaliseGatewayPhone(process.env.BOOKA_GATEWAY_PHONE);
}

/** A wa.me deep link that opens a chat with the gateway, pre-filled. */
export function buildGatewayChatLink(text: string): string | null {
  const phone = getBookaGatewayPhone();
  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
