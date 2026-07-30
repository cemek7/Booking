import type { SiteTheme } from './tokens';

export function themeVars(t: SiteTheme): React.CSSProperties {
  return {
    ['--sc-background' as string]: t.colors.background,
    ['--sc-foreground' as string]: t.colors.foreground,
    ['--sc-muted' as string]: t.colors.muted,
    ['--sc-surface' as string]: t.colors.surface,
    ['--sc-primary' as string]: t.colors.primary,
    ['--sc-primary-fg' as string]: t.colors.primaryForeground,
    ['--sc-accent' as string]: t.colors.accent,
    ['--sc-border' as string]: t.colors.border,
    ['--sc-font-display' as string]: `'${t.typography.display}', system-ui, sans-serif`,
    ['--sc-font-body' as string]: `'${t.typography.body}', system-ui, sans-serif`,
  };
}
