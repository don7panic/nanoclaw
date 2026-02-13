import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Heritage Neutrals - Bone, Ivory, Cream palette
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',

        // Core surfaces
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // Muted tones for secondary content
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },

        // Brand Accents - Deep Navy, Burgundy, Forest Green
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },

        // Gold and Brass accents
        gold: {
          DEFAULT: 'hsl(var(--gold))',
          muted: 'hsl(var(--gold-muted))',
          light: 'hsl(var(--gold-light))',
        },

        // Deep Navy - primary brand
        navy: {
          DEFAULT: 'hsl(var(--navy))',
          light: 'hsl(var(--navy-light))',
          dark: 'hsl(var(--navy-dark))',
        },

        // Burgundy - secondary accent
        burgundy: {
          DEFAULT: 'hsl(var(--burgundy))',
          light: 'hsl(var(--burgundy-light))',
          dark: 'hsl(var(--burgundy-dark))',
        },

        // Forest Green - tertiary
        forest: {
          DEFAULT: 'hsl(var(--forest))',
          light: 'hsl(var(--forest-light))',
        },

        // Semantic colors - muted heritage tones
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

      fontFamily: {
        // Classic serif for headings - evokes heritage
        serif: ['Playfair Display', 'Georgia', 'serif'],
        // Refined sans-serif for body
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // Monospace for technical elements
        mono: ['JetBrains Mono', 'monospace'],
      },

      borderRadius: {
        // Subtle, refined radius
        sm: '2px',
        DEFAULT: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
      },

      boxShadow: {
        // Soft, elegant shadows
        panel: '0 4px 20px -4px rgba(25, 35, 45, 0.08)',
        card: '0 2px 12px -2px rgba(25, 35, 45, 0.06)',
        elevated: '0 8px 30px -6px rgba(25, 35, 45, 0.12)',
        inner: 'inset 0 1px 3px rgba(25, 35, 45, 0.08)',
      },

      letterSpacing: {
        // Classic luxury often uses generous letter-spacing
        widest: '0.15em',
        wider: '0.08em',
        wide: '0.03em',
      },

      keyframes: {
        // Elegant, subtle animations
        breathe: {
          '0%, 100%': { transform: 'scale(0.96)', opacity: '0.6' },
          '50%': { transform: 'scale(1)', opacity: '1' },
        },
        riseIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },

      animation: {
        breathe: 'breathe 3s ease-in-out infinite',
        'rise-in': 'riseIn 500ms cubic-bezier(0.25, 0.1, 0.25, 1) both',
        shimmer: 'shimmer 2s ease-in-out infinite',
      },

      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-subtle':
          'linear-gradient(180deg, rgba(250, 248, 245, 0.8), rgba(248, 245, 240, 0.4))',
        'gold-shimmer':
          'linear-gradient(90deg, transparent 0%, rgba(184, 159, 115, 0.15) 50%, transparent 100%)',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
