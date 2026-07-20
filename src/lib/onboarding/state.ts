type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordLike) : {};
}

export interface TenantOnboardingStateRow {
  settings?: RecordLike | null;
  metadata?: RecordLike | null;
}

export interface TenantOnboardingState {
  managedOnboarding: boolean;
  onboardingCompleted: boolean;
}

export function readTenantOnboardingState(row: TenantOnboardingStateRow | null | undefined): TenantOnboardingState {
  const settings = asRecord(row?.settings);
  const metadata = asRecord(row?.metadata);
  const uiSettings = asRecord(metadata.ui_settings);

  const managedOnboarding =
    settings.managedOnboarding === true ||
    uiSettings.managedOnboarding === true ||
    metadata.managedOnboarding === true;

  const onboardingCompleted =
    settings.onboardingCompleted === true ||
    uiSettings.onboardingCompleted === true ||
    metadata.onboardingCompleted === true;

  return { managedOnboarding, onboardingCompleted };
}

export function isTenantOnboardingIncomplete(row: TenantOnboardingStateRow | null | undefined): boolean {
  const state = readTenantOnboardingState(row);
  return state.managedOnboarding && !state.onboardingCompleted;
}
