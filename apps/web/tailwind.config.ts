import type { Config } from 'tailwindcss';

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        'surface-2': v('surface-2'),
        border: v('border'),
        fg: v('fg'),
        muted: v('muted'),
        primary: { DEFAULT: v('primary'), fg: v('primary-fg') },
        accent: v('accent'),
        coral: v('coral'),
        success: v('success'),
        warning: v('warning'),
        danger: v('danger'),
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.25rem', '3xl': '1.75rem' },
      boxShadow: {
        soft: '0 1px 2px rgb(0 0 0 / 0.12), 0 8px 24px -8px rgb(0 0 0 / 0.25)',
        glow: '0 0 0 1px rgb(var(--primary) / 0.25), 0 10px 40px -10px rgb(var(--primary) / 0.45)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, rgb(var(--primary)) 0%, rgb(var(--accent)) 100%)',
        'warm-gradient': 'linear-gradient(135deg, rgb(var(--accent)) 0%, rgb(var(--coral)) 100%)',
      },
      keyframes: {
        orbit: { to: { transform: 'rotate(360deg)' } },
        pulseRing: { '0%': { transform: 'scale(0.8)', opacity: '0.7' }, '100%': { transform: 'scale(2.2)', opacity: '0' } },
        bounceDot: { '0%, 80%, 100%': { transform: 'translateY(0)', opacity: '0.5' }, '40%': { transform: 'translateY(-4px)', opacity: '1' } },
      },
      animation: {
        orbit: 'orbit 6s linear infinite',
        'orbit-fast': 'orbit 2.4s linear infinite',
        'pulse-ring': 'pulseRing 2.2s cubic-bezier(0.2, 0.6, 0.4, 1) infinite',
        'bounce-dot': 'bounceDot 1.2s infinite ease-in-out',
      },
    },
  },
  plugins: [],
} satisfies Config;
