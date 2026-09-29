/* Nexlink brand palette — mirrors static/css/base.css design tokens. */

export const lightColors = {
  bg: '#f0f2f5',
  chatBg: '#efeae2',
  panel: '#ffffff',
  surface: '#ffffff',
  surfaceAlt: '#f0f2f5',
  surfaceSoft: '#f8f9fc',
  border: '#d1d7db',
  text: '#111b21',
  muted: '#667781',
  primary: '#00a884',
  primaryStrong: '#008069',
  primarySoft: '#e7f8f1',
  bubbleIn: '#ffffff',
  bubbleOut: '#d9fdd3',
  bubbleOutText: '#111b21',
  tick: '#8696a0',
  tickRead: '#53bdeb',
  success: '#25d366',
  successSoft: '#e9f9ef',
  danger: '#ef4444',
  dangerSoft: '#fdecec',
  warning: '#f59e0b',
  welcomeBg: '#071d22',
  welcomeText: '#f2fffb',
  statusBar: 'dark-content',
};

export const darkColors = {
  bg: '#0b141a',
  chatBg: '#0b141a',
  panel: '#202c33',
  surface: '#202c33',
  surfaceAlt: '#2a3942',
  surfaceSoft: '#2a3942',
  border: '#2f3b43',
  text: '#e9edef',
  muted: '#8696a0',
  primary: '#00a884',
  primaryStrong: '#00a884',
  primarySoft: '#2a3942',
  bubbleIn: '#202c33',
  bubbleOut: '#005c4b',
  bubbleOutText: '#e9edef',
  tick: '#8696a0',
  tickRead: '#53bdeb',
  success: '#25d366',
  successSoft: '#1d3327',
  danger: '#ef4444',
  dangerSoft: '#3d2327',
  warning: '#f59e0b',
  welcomeBg: '#071d22',
  welcomeText: '#f2fffb',
  statusBar: 'light-content',
};

/* The accent choices from the web dashboard's Appearance settings
   (static/js/nexus.js). Web defaults: mint #74ffd6 on dark, teal #00a884
   on light — the default here follows the active theme too. */
export const ACCENT_CHOICES = [
  '#74ffd6',
  '#00a884',
  '#06cf9c',
  '#2dd4bf',
  '#0ea5e9',
  '#f59e0b',
  '#ec4899',
  '#ef4444',
];

export const DEFAULT_ACCENT = { light: '#00a884', dark: '#74ffd6' };

/* Pre-rebrand saved accents (Midnight Violet era) map onto the teal family. */
export const LEGACY_ACCENT = {
  '#a78bfa': '#74ffd6',
  '#8b5cf6': '#00a884',
  '#ec4899': '#06cf9c',
  '#f472b6': '#2dd4bf',
  '#06b6d4': '#06b6a4',
};

export function normalizeAccent(hex) {
  const value = String(hex || '').toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(value)) return null;
  return LEGACY_ACCENT[value] || value;
}

/* Mix an accent color with a base at `ratio` (0..1) — used for soft tints. */
export function withAlpha(hex, ratio) {
  const value = normalizeAccent(hex) || '#74ffd6';
  const r = parseInt(value.slice(1, 3), 16);
  const g = parseInt(value.slice(3, 5), 16);
  const b = parseInt(value.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${ratio})`;
}
