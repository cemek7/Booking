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
  };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  console.log(JSON.stringify(buildMetaPilotReadiness(), null, 2));
}
