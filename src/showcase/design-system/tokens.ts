export type SiteTheme = {
  id: string;
  colors: { background: string; foreground: string; muted: string; surface: string; primary: string; primaryForeground: string; accent: string; border: string };
  typography: { display: string; body: string; mono?: string };
  radius: 'none' | 'small' | 'medium' | 'large';
  density: 'compact' | 'balanced' | 'spacious';
  motion: 'minimal' | 'subtle' | 'expressive';
};
