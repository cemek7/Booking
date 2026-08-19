function num(env: string, fallback: number): number {
  const value = Number(process.env[env]);
  return Number.isFinite(value) ? value : fallback;
}

function positive(value: number, fallback: number): number {
  return value > 0 ? value : fallback;
}

export const CAPS = {
  velocityCredits(): number {
    return positive(num('VELOCITY_CREDITS', 200), 200);
  },

  velocityWindowMs(): number {
    return positive(num('VELOCITY_WINDOW_MIN', 10), 10) * 60 * 1000;
  },

  dailyDefault(): number {
    return positive(num('DAILY_BUDGET_DEFAULT', 2000), 2000);
  },

  dailyPlatformMax(): number {
    return positive(num('DAILY_BUDGET_PLATFORM_MAX', 20000), 20000);
  },

  softWarnPct(): number {
    const value = num('SOFT_WARN_PCT', 0.8);
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  },

  enforced(): boolean {
    return (process.env.SPEND_CAPS_ENFORCED ?? 'true') !== 'false';
  },

  resolveDailyBudget(tenantBudget: number | null | undefined): number {
    const value = typeof tenantBudget === 'number' && Number.isFinite(tenantBudget)
      ? tenantBudget
      : this.dailyDefault();
    return Math.min(Math.max(0, value), this.dailyPlatformMax());
  },

  resolveVelocity(override: number | null | undefined): number {
    const value = typeof override === 'number' && Number.isFinite(override)
      ? override
      : this.velocityCredits();
    return Math.max(0, value);
  },
};
