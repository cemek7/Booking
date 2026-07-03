export const EMAIL_SENDER_KEYS = [
  'default',
  'security',
  'bookings',
  'billing',
  'support',
  'newsletter',
  'updates',
] as const;

export type EmailSenderKey = (typeof EMAIL_SENDER_KEYS)[number];

function getDefaultSender(): string | undefined {
  return (
    process.env.EMAIL_DEFAULT_FROM ||
    process.env.RESEND_FROM_EMAIL ||
    process.env.SENDGRID_FROM_EMAIL ||
    undefined
  );
}

export function resolveSenderAddress(senderKey: EmailSenderKey = 'default'): string | undefined {
  const senderEnvByKey: Record<EmailSenderKey, string | undefined> = {
    default: process.env.EMAIL_DEFAULT_FROM,
    security: process.env.EMAIL_SECURITY_FROM,
    bookings: process.env.EMAIL_BOOKINGS_FROM,
    billing: process.env.EMAIL_BILLING_FROM,
    support: process.env.EMAIL_SUPPORT_FROM,
    newsletter: process.env.EMAIL_NEWSLETTER_FROM,
    updates: process.env.EMAIL_UPDATES_FROM,
  };
  return senderEnvByKey[senderKey] || getDefaultSender();
}
