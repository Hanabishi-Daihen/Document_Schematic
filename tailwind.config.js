// Design tokens — docs/DESIGN.md (สีชุดเดียวกับ CSS variables ใน gas/ui/Styles.html)
module.exports = {
  content: ['./gas/ui/*.html'],
  theme: {
    extend: {
      colors: {
        primary: '#cc785c', 'primary-active': '#a9583e', 'primary-disabled': '#e6dfd8',
        ink: '#141413', body: '#3d3d3a', 'body-strong': '#252523', muted: '#6c6a64', 'muted-soft': '#8e8b82',
        hairline: '#e6dfd8', 'hairline-soft': '#ebe6df',
        canvas: '#faf9f5', 'surface-soft': '#f5f0e8', 'surface-card': '#efe9de', 'surface-cream-strong': '#e8e0d2',
        'surface-dark': '#181715', 'surface-dark-elevated': '#252320', 'surface-dark-soft': '#1f1e1b',
        'on-dark': '#faf9f5', 'on-dark-soft': '#a09d96',
        'accent-teal': '#5db8a6', 'accent-amber': '#e8a55a', success: '#5db872', warning: '#d4a017', error: '#c64545',
      },
      fontFamily: {
        display: ['"Noto Serif Thai"', 'Georgia', 'serif'],
        sans: ['"IBM Plex Sans Thai"', '-apple-system', '"Segoe UI"', 'Tahoma', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: { xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '16px', pill: '9999px' },
    },
  },
};
