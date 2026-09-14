/**
 * Meta template parameters are positional: the registry stores a param mapping
 * and the provider adapters want `[{ default }]`. Four senders were each
 * carrying their own copy of this conversion; this is the single one.
 */
export function toTemplateParameters(
  paramMapping: unknown[],
): Array<{ default: string }> {
  return paramMapping.map((entry) => {
    if (entry && typeof entry === "object" && "default" in entry) {
      return {
        default: String((entry as { default?: unknown }).default ?? ""),
      };
    }

    return { default: String(entry ?? "") };
  });
}
