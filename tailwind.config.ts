import type { Config } from 'tailwindcss';

// FinFlow paper-warm palette (from FinFlow Designs wireframes)
// CSS variables drive the actual values so dark mode swaps cleanly
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg:        'hsl(var(--bg))',
        bg2:       'hsl(var(--bg2))',
        bg3:       'hsl(var(--bg3))',
        bg4:       'hsl(var(--bg4))',
        ink:       'hsl(var(--ink))',
        'ink-mid': 'hsl(var(--ink-mid))',
        'ink-dim': 'hsl(var(--ink-dim))',
        coral:     'hsl(var(--coral))',
        'coral-tint':'hsl(var(--coral-tint))',
        terra:     'hsl(var(--terra))',
        honey:     'hsl(var(--honey))',
        butter:    'hsl(var(--butter))',
        sage:      'hsl(var(--sage))',
        olive:     'hsl(var(--olive))',
        denim:     'hsl(var(--denim))',
        plum:      'hsl(var(--plum))',
        line:      'hsl(var(--line))',
        line2:     'hsl(var(--line2))',
      },
      fontFamily: {
        display: ['Outfit', '"Inter Tight"', 'sans-serif'],
        ui:      ['Inter', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: '6px', md: '8px', lg: '18px', pill: '999px',
        r1: '8px', r2: '12px', r3: '18px', r4: '26px',
      },
      boxShadow: {
        '1': 'var(--neu-sm)',
        '2': 'var(--neu)',
        '3': 'var(--neu-lg)',
        neu: 'var(--neu)',
        'neu-sm': 'var(--neu-sm)',
        'neu-inset': 'var(--neu-inset)',
        'neu-hover': 'var(--neu-hover)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(.34,1.56,.64,1)',
      },
      keyframes: {
        modalIn: {
          '0%': { opacity: '0', transform: 'translateY(12px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        toastIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        modalIn: 'modalIn 0.22s ease',
        toastIn: 'toastIn 0.28s ease',
      },
    },
  },
  plugins: [],
};

export default config;
