import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        danger: {
          DEFAULT: 'hsl(var(--danger))',
          foreground: 'hsl(var(--danger-foreground))',
        },
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.25rem',
      },
      boxShadow: {
        panel: '0 24px 50px -24px rgba(100, 120, 140, 0.12)',
        glow: '0 0 0 1px rgba(14, 165, 197, 0.25), 0 0 30px -18px rgba(14, 165, 197, 0.35)',
      },
      keyframes: {
        breathe: {
          '0%, 100%': { transform: 'scale(0.92)', opacity: '0.5' },
          '50%': { transform: 'scale(1)', opacity: '1' },
        },
        pulseFast: {
          '0%, 100%': { transform: 'scale(0.9)', opacity: '0.6' },
          '50%': { transform: 'scale(1.08)', opacity: '1' },
        },
        breatheSlow: {
          '0%, 100%': { transform: 'scale(0.9)', opacity: '0.4' },
          '50%': { transform: 'scale(1)', opacity: '0.95' },
        },
        riseIn: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        breathe: 'breathe 1.7s ease-in-out infinite',
        'pulse-fast': 'pulseFast 0.95s ease-in-out infinite',
        'breathe-slow': 'breatheSlow 2.4s ease-in-out infinite',
        'rise-in': 'riseIn 450ms ease-out both',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
