/** Stable redaction token written into PII columns when anonymizing. */
export const ERASED = '[erased]';

/**
 * Build an UPDATE patch that overwrites each PII column with the redaction token.
 * Returns an empty object when there is nothing to redact (caller should skip).
 */
export function buildAnonymizedPatch(piiColumns: string[]): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const column of piiColumns) {
    patch[column] = ERASED;
  }
  return patch;
}
