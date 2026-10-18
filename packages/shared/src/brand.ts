/**
 * Central branding configuration. Change the product name, tagline, contact
 * addresses and colour tokens here; the web app and worker read from this file.
 * (VITE_APP_NAME can still override the display name at build time.)
 */
export const BRAND = {
  name: 'Talksy',
  shortName: 'Talksy',
  tagline: 'A random hello could become a great conversation.',
  description:
    'Meet someone new in seconds. Anonymous, real-time text conversations with people around the world — free, no sign-up form required.',
  supportEmail: 'support@yourdomain.com',
  abuseEmail: 'abuse@yourdomain.com',
  privacyEmail: 'privacy@yourdomain.com',
  legalEntity: 'Talksy (operator name to be configured)',
  termsVersion: '2026-10-01',
  colors: {
    navy: '#0B1020',
    charcoal: '#141A2E',
    teal: '#14E0C4',
    blue: '#3D7BFF',
    coral: '#FF7A6B',
  },
} as const;
