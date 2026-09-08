import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_GRAPH_API_VERSION = 'v25.0';

function configured(env, name) {
  return Boolean(env[name]?.trim());
}

function resolveHttpsAppUrl(env) {
  const raw = env.APP_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim() || '';
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function buildMetaPilotReadiness(env = process.env) {
  const appUrl = resolveHttpsAppUrl(env);
  const whatsappApiVersion = env.WHATSAPP_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION;
  const whatsappWebhookUrl = appUrl
    ? `${appUrl}/api/webhooks/whatsapp/meta`
    : null;
  const instagramWebhookUrl = appUrl
    ? `${appUrl}/api/webhooks/instagram`
    : null;
  const instagramOauthRedirectUri = appUrl
    ? `${appUrl}/api/auth/instagram/callback`
    : null;

  const whatsappMissing = [];
  if (!appUrl) whatsappMissing.push('APP_URL (HTTPS required)');
  if (!configured(env, 'META_APP_ID')) whatsappMissing.push('META_APP_ID');
  if (!configured(env, 'WHATSAPP_APP_SECRET')) {
    whatsappMissing.push('WHATSAPP_APP_SECRET');
  }
  if (!configured(env, 'WHATSAPP_WEBHOOK_VERIFY_TOKEN')) {
    whatsappMissing.push('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
  }
  if (!configured(env, 'WHATSAPP_BUSINESS_ACCOUNT_ID')) {
    whatsappMissing.push('WHATSAPP_BUSINESS_ACCOUNT_ID');
  }
  if (!configured(env, 'WHATSAPP_PHONE_NUMBER_ID')) {
    whatsappMissing.push('WHATSAPP_PHONE_NUMBER_ID');
  }
  if (!configured(env, 'WHATSAPP_ACCESS_TOKEN')) {
    whatsappMissing.push('WHATSAPP_ACCESS_TOKEN');
  }
  if (
    !configured(env, 'WHATSAPP_API_VERSION') ||
    whatsappApiVersion !== DEFAULT_GRAPH_API_VERSION
  ) {
    whatsappMissing.push(
      `WHATSAPP_API_VERSION (must be ${DEFAULT_GRAPH_API_VERSION})`,
    );
  }

  const instagramMissing = [];
  if (!appUrl) instagramMissing.push('APP_URL (HTTPS required)');
  for (const name of [
    'INSTAGRAM_APP_ID',
    'INSTAGRAM_APP_SECRET',
    'INSTAGRAM_WEBHOOK_VERIFY_TOKEN',
    'INSTAGRAM_OAUTH_STATE_SECRET',
  ]) {
    if (!configured(env, name)) instagramMissing.push(name);
  }
  if (
    !configured(env, 'INSTAGRAM_OAUTH_REDIRECT_URI') ||
    env.INSTAGRAM_OAUTH_REDIRECT_URI.trim() !== instagramOauthRedirectUri
  ) {
    instagramMissing.push('INSTAGRAM_OAUTH_REDIRECT_URI (must exactly match callback URL)');
  }

  const whatsappStatus = whatsappMissing.length === 0
    ? 'controlled_pilot_ready'
    : 'not_ready';
  const instagramStatus = instagramMissing.length === 0
    ? 'controlled_pilot_ready'
    : 'not_ready';

  // ── Message metering (2026-10-01 cutover) ─────────────────────────────────
  // From that date Meta bills every delivered service message. Two things can
  // go wrong silently and neither shows up anywhere else: the mode is never
  // flipped to `live`, so Booka absorbs every message indefinitely; or it is
  // flipped without a confirmed rate, so tenants are billed off the provisional
  // NGN 14 fallback in messageRates.ts rather than Meta's published number.
  const meteringMode = env.BOOKA_MESSAGE_METERING_MODE === 'live' ? 'live' : 'shadow';
  const meteringWarnings = [];
  if (meteringMode === 'live' && !configured(env, 'BOOKA_MESSAGE_RATE_CREDITS')) {
    meteringWarnings.push(
      'BOOKA_MESSAGE_RATE_CREDITS is unset while metering is live — tenants are '
      + 'being charged off the provisional fallback rate, not a confirmed one',
    );
  }
  if (meteringMode === 'shadow' && new Date() >= new Date('2026-10-01T00:00:00Z')) {
    meteringWarnings.push(
      'Metering is still in shadow mode after 2026-10-01 — Meta is billing Booka '
      + 'for these messages and no tenant is being charged',
    );
  }

  // ── Meta payment method (hard deadline 2026-09-30) ────────────────────────
  // Meta stops delivering service messages on 2026-10-01 for any provider
  // without a payment method on file. No API reports this, so it is an
  // attestation: set BOOKA_META_PAYMENT_METHOD_ON_FILE=true once it is done.
  // Until then this counts down, because forgetting it silences every tenant.
  const paymentMethodOnFile = configured(env, 'BOOKA_META_PAYMENT_METHOD_ON_FILE')
    && env.BOOKA_META_PAYMENT_METHOD_ON_FILE !== 'false';
  const paymentDeadline = new Date('2026-09-30T23:59:59Z');
  const daysToPaymentDeadline = Math.ceil((paymentDeadline - new Date()) / 86400000);
  if (!paymentMethodOnFile) {
    meteringWarnings.push(
      daysToPaymentDeadline >= 0
        ? `No payment method attested on the WhatsApp Business Account. Meta stops `
          + `delivering service messages on 2026-10-01 without one — ${daysToPaymentDeadline} `
          + `days left. Set BOOKA_META_PAYMENT_METHOD_ON_FILE=true once it is added.`
        : `PAST DEADLINE: no payment method attested on the WhatsApp Business Account. `
          + `Meta may already have stopped delivering service messages.`,
    );
  }

  const publicOnboardingConfigured = Boolean(
    appUrl &&
    configured(env, 'META_APP_ID') &&
    (configured(env, 'META_APP_SECRET') || configured(env, 'WHATSAPP_APP_SECRET')) &&
    configured(env, 'WHATSAPP_WEBHOOK_VERIFY_TOKEN') &&
    configured(env, 'META_EMBEDDED_SIGNUP_CONFIG_ID')
  );

  return {
    overallStatus:
      whatsappStatus === 'controlled_pilot_ready' &&
      instagramStatus === 'controlled_pilot_ready'
        ? 'controlled_pilot_ready'
        : 'not_ready',
    whatsapp: {
      status: whatsappStatus,
      missing: whatsappMissing,
      apiVersion: whatsappApiVersion,
      webhookUrl: whatsappWebhookUrl,
      publicOnboardingConfigured,
      metaApprovalVerified: false,
    },
    instagram: {
      status: instagramStatus,
      missing: instagramMissing,
      apiVersion: DEFAULT_GRAPH_API_VERSION,
      webhookUrl: instagramWebhookUrl,
      oauthRedirectUri: instagramOauthRedirectUri,
    },
    messageMetering: {
      mode: meteringMode,
      rateConfigured: configured(env, 'BOOKA_MESSAGE_RATE_CREDITS'),
      paymentMethodOnFile,
      daysToPaymentDeadline,
      warnings: meteringWarnings,
    },
  };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  console.log(JSON.stringify(buildMetaPilotReadiness(), null, 2));
}
