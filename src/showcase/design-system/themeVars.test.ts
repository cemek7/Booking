import { describe, it, expect } from '@jest/globals';
import { themeVars } from './themeVars';
import { NORTHSTAR_THEME, SUNGRID_THEME } from './themes';

describe('themeVars', () => {
  it('maps a SiteTheme to --sc-* custom properties', () => {
    const v = themeVars(SUNGRID_THEME) as Record<string, string>;
    expect(v['--sc-primary']).toBe(SUNGRID_THEME.colors.primary);
    expect(v['--sc-background']).toBe(SUNGRID_THEME.colors.background);
    expect(v['--sc-font-display']).toContain(SUNGRID_THEME.typography.display);
  });
});

describe('Northstar theme', () => {
  it('maps the published Northstar theme to its scoped custom properties', () => {
    const v = themeVars(NORTHSTAR_THEME) as Record<string, string>;
    expect(NORTHSTAR_THEME.id).toBe('northstar');
    expect(v['--sc-primary']).toBe(NORTHSTAR_THEME.colors.primary);
  });
});
