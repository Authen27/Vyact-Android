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
        display: ['Newsreader', 'Georgia', 'serif'],
        ui:      ['"Inter Tight"', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: '4px', md: '8px', lg: '14px', pill: '999px',
      },
      boxShadow: {
        '1': '0 2px 6px hsl(var(--shadow) / 0.06)',
        '2': '0 8px 20px hsl(var(--shadow) / 0.10)',
        '3': '0 16px 40px hsl(var(--shadow) / 0.18)',
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
