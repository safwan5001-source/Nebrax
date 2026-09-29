/**
 * AWJ tokens, mirrored 1:1 from web/src/app/globals.css + DESIGN_SYSTEM.md.
 * The film never imports from web/ so it stays isolated; if the product tokens change,
 * update this file.
 */
export type Theme = {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  primarySoft: string;
  positive: string;
  negative: string;
  warning: string;
};

export const light: Theme = {
  bg: '#F6F7F9',
  surface: '#FFFFFF',
  text: '#15181D',
  muted: '#6B7280',
  border: '#ECEEF1',
  primary: '#1E40AF',
  primarySoft: '#EEF2FF',
  positive: '#166534',
  negative: '#B91C1C',
  warning: '#92400E',
};

export const dark: Theme = {
  bg: '#0E1014',
  surface: '#181B20',
  text: '#F3F4F6',
  muted: '#9099A5',
  border: '#262A31',
  primary: '#4F8CFF',
  primarySoft: '#1B2740',
  positive: '#16A34A',
  negative: '#F87171',
  warning: '#D97706',
};

export const BRAND_BLUE = '#1E40AF';

export const SANS = "'IBM Plex Sans Arabic', sans-serif";
export const MONO = "'IBM Plex Mono', monospace";
