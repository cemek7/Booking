function num(env: string, def: number): number {
  const value = Number(process.env[env]);
  return Number.isFinite(value) ? value : def;
}

export type Quality = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';

export const CFG = {
  windowMs: () => num('META_SERVICE_WINDOW_HOURS', 24) * 60 * 60 * 1000,
  optOutDanger: () => num('OPT_OUT_DANGER', 0.02),
  failureDanger: () => num('FAILURE_DANGER', 0.05),
  quarantineThreshold: () => num('QUARANTINE_THRESHOLD', 0.8),
  quarantineHours: () => num('QUARANTINE_HOURS', 24),
  tenantWeight: () => num('TENANT_WEIGHT_DEFAULT', 0.05),
  weights: () => ({
    volume: num('RISK_W_VOLUME', 0.35),
    cold: num('RISK_W_COLD', 0.30),
    optOut: num('RISK_W_OPTOUT', 0.20),
    failure: num('RISK_W_FAILURE', 0.15),
  }),
  qualityFactor: (quality: Quality): number =>
    quality === 'GREEN'
      ? num('QUALITY_FACTOR_GREEN', 1.0)
      : quality === 'YELLOW'
        ? num('QUALITY_FACTOR_YELLOW', 0.5)
        : quality === 'RED'
          ? num('QUALITY_FACTOR_RED', 0.25)
          : num('QUALITY_FACTOR_YELLOW', 0.5),
  graduationPerDay: () => num('GRADUATION_INITIATED_PER_DAY', 500),
  graduationDays: () => num('GRADUATION_SUSTAINED_DAYS', 3),
  sharedPhoneNumberId: () => process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
};
