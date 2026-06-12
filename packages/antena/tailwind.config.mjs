/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      colors: {
        // Backgrounds
        'bg-base':     'var(--bg-base)',
        'bg-elevated': 'var(--bg-elevated)',
        'bg-hover':    'var(--bg-hover)',

        // Text
        'text-primary':   'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary':  'var(--text-tertiary)',

        // Borders
        'border-base':    'var(--border)',
        'border-strong':  'var(--border-strong)',

        // Accent
        accent:        'var(--accent)',
        'accent-hover':'var(--accent-hover)',
        'accent-muted':'var(--accent-muted)',

        // Bias
        bias: {
          officialist:    'var(--bias-officialist)',
          'officialist-dk': 'var(--bias-officialist-dk)',
          neutral:       'var(--bias-neutral)',
          opposition:    'var(--bias-opposition)',
          'opposition-dk': 'var(--bias-opposition-dk)',
        },

        // Categories
        cat: {
          politica:      'var(--cat-politica)',
          economia:      'var(--cat-economia)',
          deportes:      'var(--cat-deportes)',
          policiales:    'var(--cat-policiales)',
          cultura:      'var(--cat-cultura)',
          tecnologia:   'var(--cat-tecnologia)',
          sociedad:     'var(--cat-sociedad)',
          internacional:'var(--cat-internacional)',
        },
      },

      fontFamily: {
        display: ['Syne', 'system-ui', 'sans-serif'],
        body:    ['DM Sans', 'system-ui', 'sans-serif'],
        mono:    ['JetBrains Mono', 'monospace'],
      },

      fontSize: {
        xs:   ['var(--text-xs)',   { lineHeight: '1.4' }],
        sm:   ['var(--text-sm)',   { lineHeight: '1.5' }],
        base: ['var(--text-base)', { lineHeight: '1.5' }],
        lg:   ['var(--text-lg)',   { lineHeight: '1.3' }],
        xl:   ['var(--text-xl)',   { lineHeight: '1.2' }],
        '2xl':['var(--text-2xl)',  { lineHeight: '1.1' }],
      },

      spacing: {
        1:  '4px',
        2:  '8px',
        3:  '12px',
        4:  '16px',
        5:  '20px',
        6:  '24px',
        8:  '32px',
        10: '40px',
        12: '48px',
      },

      borderRadius: {
        sm:  '6px',
        md:  '10px',
        lg:  '14px',
        xl:  '20px',
        full: '9999px',
      },

      boxShadow: {
        sm:  'var(--shadow-sm)',
        md:  'var(--shadow-md)',
        lg:  'var(--shadow-lg)',
        card: 'var(--shadow-card)',
      },

      maxWidth: {
        feed:    'var(--feed-max-width)',
        sidebar: 'var(--sidebar-width)',
      },

      transitionDuration: {
        fast:   '100ms',
        normal: '200ms',
        slow:   '300ms',
      },

      transitionTimingFunction: {
        ease: 'ease',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [],
};