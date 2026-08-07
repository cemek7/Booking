import type { SiteTheme } from './tokens';

export const SUNGRID_THEME: SiteTheme = {
  id: 'sungrid',
  colors: { background: '#0b1f2a', foreground: '#eef6f8', muted: '#8fb0bd', surface: '#12303e', primary: '#f5a623', primaryForeground: '#0b1f2a', accent: '#2ec4b6', border: '#1d475a' },
  typography: { display: 'Space Grotesk', body: 'Inter' },
  radius: 'medium', density: 'balanced', motion: 'subtle',
};

export const NORTHSTAR_THEME: SiteTheme = {
  id: 'northstar',
  colors: { background: '#f7fafc', foreground: '#0f2231', muted: '#5b7183', surface: '#ffffff', primary: '#2f6fed', primaryForeground: '#ffffff', accent: '#34c3a0', border: '#dce6ee' },
  typography: { display: 'Manrope', body: 'Inter' },
  radius: 'large', density: 'spacious', motion: 'minimal',
};

export const EMBER_THEME: SiteTheme = {
  id: 'ember',
  colors: { background: '#140f0c', foreground: '#f4ece2', muted: '#a68f7d', surface: '#211812', primary: '#c8542b', primaryForeground: '#f4ece2', accent: '#e0a458', border: '#35271d' },
  typography: { display: 'Playfair Display', body: 'Inter' },
  radius: 'small', density: 'balanced', motion: 'subtle',
};
