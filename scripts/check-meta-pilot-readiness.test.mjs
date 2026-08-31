import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMetaPilotReadiness } from './check-meta-pilot-readiness.mjs';

function runChecker(configuration = {}) {
  const readiness = buildMetaPilotReadiness(configuration);
  return { output: JSON.stringify(readiness), readiness };
}

const controlledPilotEnvironment = {
  APP_URL: 'https://staging.app.techclave.cloud',
  META_APP_ID: 'public-whatsapp-app-id',
  META_APP_SECRET: 'private-whatsapp-app-secret',
  WHATSAPP_APP_SECRET: 'private-whatsapp-webhook-secret',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'private-whatsapp-verify-token',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'public-waba-id',
  WHATSAPP_PHONE_NUMBER_ID: 'public-phone-id',
  WHATSAPP_ACCESS_TOKEN: 'private-whatsapp-access-token',
  WHATSAPP_API_VERSION: 'v25.0',
  INSTAGRAM_APP_ID: 'public-instagram-app-id',
  INSTAGRAM_APP_SECRET: 'private-instagram-app-secret',
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'private-instagram-verify-token',
  INSTAGRAM_OAUTH_STATE_SECRET: 'private-instagram-state-secret',
  INSTAGRAM_OAUTH_REDIRECT_URI:
    'https://staging.app.techclave.cloud/api/auth/instagram/callback',
};

test('reports an empty environment as not ready', () => {
  const { readiness } = runChecker();

  assert.equal(readiness.overallStatus, 'not_ready');
  assert.equal(readiness.whatsapp.status, 'not_ready');
  assert.equal(readiness.instagram.status, 'not_ready');
  assert.ok(readiness.whatsapp.missing.includes('APP_URL (HTTPS required)'));
  assert.ok(readiness.instagram.missing.includes('APP_URL (HTTPS required)'));
});

test('reports both managed channels ready without claiming public onboarding', () => {
  const { output, readiness } = runChecker(controlledPilotEnvironment);

  assert.equal(readiness.overallStatus, 'controlled_pilot_ready');
  assert.equal(readiness.whatsapp.status, 'controlled_pilot_ready');
  assert.equal(readiness.instagram.status, 'controlled_pilot_ready');
  assert.equal(readiness.whatsapp.publicOnboardingConfigured, false);
  assert.equal(
    readiness.whatsapp.webhookUrl,
    'https://staging.app.techclave.cloud/api/webhooks/whatsapp/meta',
  );
  assert.equal(
    readiness.instagram.oauthRedirectUri,
    'https://staging.app.techclave.cloud/api/auth/instagram/callback',
  );

  for (const secret of [
    controlledPilotEnvironment.META_APP_SECRET,
    controlledPilotEnvironment.WHATSAPP_APP_SECRET,
    controlledPilotEnvironment.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    controlledPilotEnvironment.WHATSAPP_ACCESS_TOKEN,
    controlledPilotEnvironment.INSTAGRAM_APP_SECRET,
    controlledPilotEnvironment.INSTAGRAM_WEBHOOK_VERIFY_TOKEN,
    controlledPilotEnvironment.INSTAGRAM_OAUTH_STATE_SECRET,
  ]) {
    assert.equal(output.includes(secret), false);
  }
});

test('does not approve WhatsApp when its webhook app secret is missing', () => {
  const { readiness } = runChecker({
    ...controlledPilotEnvironment,
    WHATSAPP_APP_SECRET: '',
  });

  assert.equal(readiness.whatsapp.status, 'not_ready');
  assert.ok(readiness.whatsapp.missing.includes('WHATSAPP_APP_SECRET'));
});

test('does not approve WhatsApp with an unsupported Graph API version', () => {
  const { readiness } = runChecker({
    ...controlledPilotEnvironment,
    WHATSAPP_API_VERSION: 'v18.0',
  });

  assert.equal(readiness.whatsapp.status, 'not_ready');
  assert.ok(
    readiness.whatsapp.missing.includes(
      'WHATSAPP_API_VERSION (must be v25.0)',
    ),
  );
});

test('reports Embedded Signup configuration separately from Meta approval', () => {
  const { readiness } = runChecker({
    ...controlledPilotEnvironment,
    META_EMBEDDED_SIGNUP_CONFIG_ID: 'public-embedded-signup-config-id',
  });

  assert.equal(readiness.whatsapp.status, 'controlled_pilot_ready');
  assert.equal(readiness.whatsapp.publicOnboardingConfigured, true);
  assert.equal(readiness.whatsapp.metaApprovalVerified, false);
});
